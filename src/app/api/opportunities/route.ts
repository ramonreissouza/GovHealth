// src/app/api/opportunities/route.ts
// Agrega dados do PNCP + TransfereGov + CNES + DOU e calcula Opportunity Scores

import { NextRequest, NextResponse } from 'next/server'
import { buscarConveniosSaudeAtivos, getMunicipiosComEmendasSaude } from '@/lib/transferegov'
import { buscarComprasSaude, normalizarLicitacao, isSaudeRelated } from '@/lib/pncp'
import {
  gerarOportunidadesDeConvenios,
  inferirRegiao,
  inferirCategoria,
  classificarTipo,
} from '@/lib/score-engine'
import { enriquecerComCNES } from '@/lib/cnes'
import { buscarPreEditaisSaude } from '@/lib/dou'
import { Oportunidade } from '@/lib/types'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { MOCK_OPORTUNIDADES } from '@/lib/mock-data'

export const runtime = 'nodejs'
export const revalidate = 1800 // 30 min

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const uf = searchParams.get('uf') ?? undefined
    const minScore = Number(searchParams.get('minScore') ?? 0)
    const categoria = searchParams.get('categoria') ?? undefined
    const regiao = searchParams.get('regiao') ?? undefined
    const tipo = searchParams.get('tipo') ?? undefined
    const limit = Number(searchParams.get('limit') ?? 50)

    // Cache de curta duração — retorna imediatamente em navegações repetidas
    const cacheKey = `opportunities:${uf ?? ''}:${minScore}:${categoria ?? ''}:${regiao ?? ''}:${tipo ?? ''}:${limit}`
    const cached = getCached<object>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Busca paralela nas quatro fontes (PNCP, TransfereGov, DOU pré-editais)
    const [conveniosResult, pncpResult, emendasResult, douResult] = await Promise.allSettled([
      buscarConveniosSaudeAtivos(uf),
      buscarComprasSaude({ uf, tamanhoPagina: 100 }),
      uf ? getMunicipiosComEmendasSaude(uf) : Promise.resolve(new Set<string>()),
      buscarPreEditaisSaude(),
    ])

    const oportunidades: Oportunidade[] = []

    // Oportunidades a partir de convênios (pré-edital — mais valiosas)
    if (conveniosResult.status === 'fulfilled') {
      const municipiosComEmendas =
        emendasResult.status === 'fulfilled' ? emendasResult.value : new Set<string>()
      const fromConvenios = gerarOportunidadesDeConvenios(
        conveniosResult.value.convenios,
        {},
        municipiosComEmendas
      )
      oportunidades.push(...fromConvenios)
    }

    // Oportunidades a partir de licitações do PNCP (abertas + históricas)
    // Enriquecidas com dados CNES (leitos e categoria do hospital)
    if (pncpResult.status === 'fulfilled') {
      const agora = new Date()
      const licitacoes = pncpResult.value.data.map(normalizarLicitacao)

      // Enriquecimento CNES em paralelo (máx 10 CNPJs para evitar sobrecarga)
      const cnpjsUnicos = [...new Set(licitacoes.map((l) => l.orgaoEntidade.cnpj).filter(Boolean))].slice(0, 10)
      const cnesCache = new Map<string, Awaited<ReturnType<typeof enriquecerComCNES>>>()
      const cnesResults = await Promise.allSettled(
        cnpjsUnicos.map((cnpj) => enriquecerComCNES(cnpj).then((r) => ({ cnpj, r })))
      )
      for (const res of cnesResults) {
        if (res.status === 'fulfilled' && res.value.r) {
          cnesCache.set(res.value.cnpj, res.value.r)
        }
      }

      for (const lic of licitacoes) {
        if (!isSaudeRelated(lic.objetoCompra)) continue
        if (!lic.valorTotalEstimado || lic.valorTotalEstimado < 50_000) continue

        const id = `lic-${lic.id}`
        const agoraISO = agora.toISOString()
        const municipio = lic.orgaoEntidade.municipio ?? 'N/D'
        const ufLic = lic.orgaoEntidade.uf ?? 'N/D'

        const cnesInfo = cnesCache.get(lic.orgaoEntidade.cnpj)

        // Verifica se o edital ainda está aberto (prazo de proposta no futuro)
        const prazoEncerramento = lic.dataEncerramentoProposta
          ? new Date(lic.dataEncerramentoProposta)
          : null
        const estaAberto = prazoEncerramento ? prazoEncerramento > agora : false

        // Calcula dias restantes para encerramento
        const diasRestantes = prazoEncerramento
          ? Math.max(0, Math.ceil((prazoEncerramento.getTime() - agora.getTime()) / 86_400_000))
          : 0

        // Score e urgência dependem do status
        let score: number
        let urgencia: 'urgente' | 'alta' | 'media' | 'normal'
        let status: 'quente' | 'morno' | 'frio'
        let janelaEmDias: number
        let acaoRecomendada: string

        // Score base por valor do contrato
        const valor = lic.valorTotalEstimado
        const scoreValor = valor >= 5_000_000 ? 20 : valor >= 1_000_000 ? 14 : valor >= 500_000 ? 8 : valor >= 100_000 ? 4 : 2

        // Ano de publicação — quanto mais recente, maior o score
        const anoPublicacao = lic.dataPublicacaoPncp
          ? parseInt(lic.dataPublicacaoPncp.substring(0, 4), 10)
          : 2023
        const scoreRecencia = anoPublicacao >= 2025 ? 25 : anoPublicacao === 2024 ? 15 : 5

        // Bônus CNES: hospital grande ou federal eleva o sub-score de órgão
        const scoreCNES = cnesInfo
          ? (cnesInfo.leitos >= 500 ? 10 : cnesInfo.leitos >= 200 ? 6 : cnesInfo.leitos >= 100 ? 3 : 0) +
            (cnesInfo.categoriaHospital === 'federal' ? 5 : cnesInfo.categoriaHospital === 'estadual' ? 3 : 0)
          : 0

        if (estaAberto && diasRestantes <= 7) {
          score = Math.min(100, 95 + scoreCNES); urgencia = 'urgente'; status = 'quente'
          janelaEmDias = diasRestantes
          acaoRecomendada = `Edital aberto — encerra em ${diasRestantes}d. Preparar proposta AGORA.`
        } else if (estaAberto && diasRestantes <= 30) {
          score = Math.min(100, 88 + scoreCNES); urgencia = 'alta'; status = 'quente'
          janelaEmDias = diasRestantes
          acaoRecomendada = `Edital aberto — ${diasRestantes} dias restantes. Iniciar proposta.`
        } else if (estaAberto) {
          score = Math.min(100, 80 + scoreCNES); urgencia = 'media'; status = 'quente'
          janelaEmDias = diasRestantes
          acaoRecomendada = 'Edital publicado e aberto — monitorar e preparar proposta.'
        } else {
          // Histórico encerrado — inteligência de mercado para antecipar próximo ciclo
          score = Math.min(85, 45 + scoreValor + scoreRecencia + scoreCNES)
          const proximoCicloAnos = anoPublicacao >= 2025 ? 4 : anoPublicacao === 2024 ? 3 : 2
          janelaEmDias = proximoCicloAnos * 365
          urgencia = score >= 75 ? 'alta' : score >= 65 ? 'media' : 'normal'
          status = score >= 75 ? 'quente' : score >= 55 ? 'morno' : 'frio'
          acaoRecomendada = `Comprou em ${anoPublicacao} — próximo ciclo estimado para ${anoPublicacao + proximoCicloAnos}. Mapear contato agora.`
        }

        // Sub-score de órgão enriquecido com CNES
        const orgaoScore = cnesInfo
          ? Math.min(100, 70 + (cnesInfo.leitos >= 500 ? 20 : cnesInfo.leitos >= 200 ? 12 : 5))
          : 80

        oportunidades.push({
          id,
          municipio,
          uf: ufLic,
          regiao: inferirRegiao(ufLic),
          hospital: lic.orgaoEntidade.razaoSocial,
          categoria: inferirCategoria(lic.objetoCompra),
          descricao: lic.objetoCompra.substring(0, 120),
          score,
          subScores: { convenio: 85, historico: 70, orgao: orgaoScore, competicao: 60 },
          valorEstimado: lic.valorTotalEstimado,
          janelaEmDias,
          urgencia,
          status,
          probabilidadeEdital: estaAberto ? 1.0 : 0.7,
          concorrentes: [],
          indiceConcorrencia: 'medio',
          acaoRecomendada,
          tipoFornecimento: classificarTipo(lic.objetoCompra),
          licitacaoRelacionada: lic,
          cnesLeitos: cnesInfo?.leitos,
          cnesCategoriaHospital: cnesInfo?.categoriaHospital,
          createdAt: agoraISO,
          updatedAt: agoraISO,
        })
      }
    }

    // Oportunidades pré-edital do DOU (avisos publicados na Seção 3)
    if (douResult.status === 'fulfilled') {
      const agora = new Date()
      const agoraISO = agora.toISOString()

      for (const aviso of douResult.value) {
        if (uf && aviso.uf && aviso.uf !== uf) continue

        const id = `dou-${aviso.id}`
        const valorEstimado = aviso.valorEstimado ?? 500_000

        oportunidades.push({
          id,
          municipio: aviso.municipio ?? 'N/D',
          uf: aviso.uf ?? 'N/D',
          regiao: inferirRegiao(aviso.uf ?? ''),
          hospital: aviso.orgao,
          categoria: inferirCategoria(aviso.titulo + ' ' + aviso.resumo),
          descricao: aviso.titulo.substring(0, 120) || aviso.resumo.substring(0, 120),
          score: 72, // pré-editais são sinais fortes
          subScores: { convenio: 60, historico: 65, orgao: 80, competicao: 70 },
          valorEstimado,
          janelaEmDias: 30,
          urgencia: 'alta',
          status: 'quente',
          probabilidadeEdital: 0.85,
          concorrentes: [],
          indiceConcorrencia: 'medio',
          acaoRecomendada: `Aviso DOU ${aviso.data} — pré-edital detectado. Contatar órgão imediatamente.`,
          tipoFornecimento: classificarTipo(aviso.titulo + ' ' + aviso.resumo),
          createdAt: agoraISO,
          updatedAt: agoraISO,
        })
      }
    }

    // Fallback: se nenhuma fonte retornou dados, usa dataset local
    if (oportunidades.length === 0) {
      oportunidades.push(...MOCK_OPORTUNIDADES)
    }

    // Deduplicar por ID (evita duplicatas entre fontes)
    const seen = new Set<string>()
    const deduped = oportunidades.filter((o) => {
      if (seen.has(o.id)) return false
      seen.add(o.id)
      return true
    })

    // Aplicar filtros
    let filtradas = deduped
    if (minScore > 0) filtradas = filtradas.filter((o) => o.score >= minScore)
    if (categoria) filtradas = filtradas.filter((o) => o.categoria === categoria)
    if (regiao) filtradas = filtradas.filter((o) => o.regiao === regiao)
    if (tipo) filtradas = filtradas.filter((o) => o.tipoFornecimento === tipo)

    // Ordenar por score desc e limitar
    const resultado = filtradas
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    // Métricas resumidas
    const kpis = {
      total: resultado.length,
      quentes: resultado.filter((o) => o.status === 'quente').length,
      valorTotal: resultado.reduce((s, o) => s + o.valorEstimado, 0),
      scoreMedio: resultado.length
        ? Math.round(resultado.reduce((s, o) => s + o.score, 0) / resultado.length)
        : 0,
      fontesAtivas: {
        transferegov: conveniosResult.status === 'fulfilled',
        pncp: pncpResult.status === 'fulfilled',
        emendas: emendasResult.status === 'fulfilled' && (emendasResult.value?.size ?? 0) > 0,
        cnes: pncpResult.status === 'fulfilled', // CNES é chamado junto com PNCP
        dou: douResult.status === 'fulfilled' && (douResult.value?.length ?? 0) > 0,
      },
    }

    const payload = { oportunidades: resultado, kpis, atualizadoEm: new Date().toISOString() }
    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[opportunities]', error)
    return NextResponse.json(
      { error: 'Erro ao calcular oportunidades', detalhe: String(error) },
      { status: 500 }
    )
  }
}
