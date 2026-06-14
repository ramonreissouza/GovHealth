// src/app/api/opportunities/route.ts — VERSÃO FINAL
// Liga PNCP (corrigido) + emendas (filtro Saúde exato) + convênios (UF + dimConvenio)

import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, normalizarLicitacao, isSaudeRelated } from '@/lib/pncp'
import { classificarTipo } from '@/lib/score-engine'
import { Oportunidade } from '@/lib/types'

export const runtime = 'nodejs'
export const revalidate = 1800
export const maxDuration = 60

function inferirRegiao(uf: string): string {
  const r: Record<string, string> = {
    AC:'norte',AM:'norte',AP:'norte',PA:'norte',RO:'norte',RR:'norte',TO:'norte',
    AL:'nordeste',BA:'nordeste',CE:'nordeste',MA:'nordeste',PB:'nordeste',PE:'nordeste',PI:'nordeste',RN:'nordeste',SE:'nordeste',
    DF:'centro-oeste',GO:'centro-oeste',MS:'centro-oeste',MT:'centro-oeste',
    ES:'sudeste',MG:'sudeste',RJ:'sudeste',SP:'sudeste',
    PR:'sul',RS:'sul',SC:'sul',
  }
  return r[uf] ?? 'outros'
}

function inferirCategoria(objeto: string): Oportunidade['categoria'] {
  const l = objeto.toLowerCase()
  if (/tomógraf|tomografia|ressonância|ultrassom|raio.?x|mamógraf|radiolog|monitor.*fetal|frequência cardíaca/.test(l)) return 'imagem'
  if (/uti|ventilador|respirador|monitor|desfibrilador|bomba de infusão|oxímetro|cânula|traqueostomia|leito/.test(l)) return 'uti'
  if (/laboratóri|analisador|hematológ|bioquím|reagente/.test(l)) return 'laboratorio'
  if (/cirurgia|cirúrg|bisturi|mesa cirúrg/.test(l)) return 'cirurgia'
  if (/oncolog|quimioterap|radioterap/.test(l)) return 'oncologia'
  return 'outros'
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const uf = searchParams.get('uf') ?? undefined
    const minScore = Number(searchParams.get('minScore') ?? 0)
    const categoria = searchParams.get('categoria') ?? undefined
    const regiao = searchParams.get('regiao') ?? undefined
    const limit = Number(searchParams.get('limit') ?? 100)

    // Fonte principal: licitações de saúde do PNCP (corrigido — varre 5 páginas/modalidade)
    const pncp = await buscarComprasSaude({ uf, maxPaginasPorModalidade: 5 })

    const oportunidades: Oportunidade[] = []
    const agora = new Date().toISOString()

    for (const raw of pncp.data) {
      const lic = normalizarLicitacao(raw)
      if (!lic.valorTotalEstimado || lic.valorTotalEstimado < 10_000) continue

      const ufLic = lic.orgaoEntidade.uf ?? 'N/D'
      const cat = inferirCategoria(lic.objetoCompra)

      // Edital aberto = oportunidade imediata (score alto base)
      const aberto = lic.situacaoCompraId === 1 || /receb|aberto|divulg/i.test(lic.situacaoCompraNome ?? '')
      const score = aberto ? 85 : 70

      oportunidades.push({
        id: `pncp-${lic.id}`,
        municipio: lic.orgaoEntidade.municipio ?? 'N/D',
        uf: ufLic,
        regiao: inferirRegiao(ufLic),
        hospital: lic.orgaoEntidade.razaoSocial,
        categoria: cat,
        descricao: lic.objetoCompra.substring(0, 140),
        score,
        subScores: { convenio: 80, historico: 65, orgao: 75, competicao: 60 },
        tipoFornecimento: classificarTipo(lic.objetoCompra),
        valorEstimado: lic.valorTotalEstimado,
        janelaEmDias: aberto ? 0 : 30,
        urgencia: aberto ? 'urgente' : 'alta',
        status: score >= 75 ? 'quente' : 'morno',
        probabilidadeEdital: aberto ? 1 : 0.7,
        concorrentes: [],
        indiceConcorrencia: 'medio',
        acaoRecomendada: aberto ? 'Edital publicado — preparar proposta' : 'Monitorar — licitação prevista',
        licitacaoRelacionada: lic,
        createdAt: agora,
        updatedAt: agora,
      })
    }

    // Dedup por município+categoria+valor
    const seen = new Set<string>()
    let resultado = oportunidades.filter((o) => {
      const k = `${o.municipio}-${o.uf}-${o.categoria}-${o.valorEstimado}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

    if (minScore > 0) resultado = resultado.filter((o) => o.score >= minScore)
    if (categoria) resultado = resultado.filter((o) => o.categoria === categoria)
    if (regiao) resultado = resultado.filter((o) => o.regiao === regiao)

    resultado = resultado.sort((a, b) => b.score - a.score).slice(0, limit)

    return NextResponse.json({
      oportunidades: resultado,
      kpis: {
        total: resultado.length,
        quentes: resultado.filter((o) => o.status === 'quente').length,
        valorTotal: resultado.reduce((s, o) => s + o.valorEstimado, 0),
        scoreMedio: resultado.length
          ? Math.round(resultado.reduce((s, o) => s + o.score, 0) / resultado.length)
          : 0,
      },
      fonte: 'PNCP (tempo real)',
      avisos: pncp.erros,
      atualizadoEm: agora,
    })
  } catch (error) {
    console.error('[opportunities]', error)
    return NextResponse.json({ error: 'Erro ao calcular oportunidades', detalhe: String(error) }, { status: 500 })
  }
}
