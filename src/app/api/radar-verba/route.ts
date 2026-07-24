// src/app/api/radar-verba/route.ts — Radar de Verba (emendas de saúde não executadas).
// Reusa a fonte tipada de emendas (Portal da Transparência) e adiciona o cálculo de
// "verba disponível" (empenhado − pago) e o score de temperatura (lib/radar-verba).

import { NextRequest, NextResponse } from 'next/server'
import { buscarEmendasSaudeAno, type EmendaParlamentar } from '@/lib/emendas'
import { lerEmendasSaude } from '@/lib/emendas-ingest'
import { toEmendaRadar, type EmendaRadar } from '@/lib/radar-verba'
import { carregarIndiceCapag } from '@/lib/capacidade-pagamento'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 7200
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase().trim() || undefined
  const ufsParam = searchParams.get('ufs') || undefined // território multi-UF
  const ufs = ufsParam ? ufsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined
  const anoParam = searchParams.get('ano')
  const tipo = searchParams.get('tipo')?.trim().toLowerCase() || undefined
  const subfuncao = searchParams.get('subfuncao')?.trim().toLowerCase() || undefined
  const valorMin = searchParams.get('valorMin') ? Number(searchParams.get('valorMin')) : 0
  const soQuentes = searchParams.get('soQuentes') === '1'

  const cacheKey = `radar:${anoParam ?? 'auto'}:${ufs?.length ? ufs.join(',') : uf ?? ''}:${tipo ?? ''}:${subfuncao ?? ''}:${valorMin}:${soQuentes ? 'q' : ''}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const anoAtual = new Date().getFullYear()
    const anos = anoParam ? [Number(anoParam)] : [anoAtual, anoAtual - 1, anoAtual - 2]

    // Caminho normal: lê do cache do banco (populado pelo cron sync-emendas) — completo
    // e instantâneo. Fallback ao vivo (limitado) só se o cache ainda estiver vazio, p/
    // a tela não quebrar antes da 1ª sincronização (ou em dev sem cron).
    let brutas: EmendaParlamentar[] = []
    let anoUsado = anos[0]
    try {
      const doBanco = await lerEmendasSaude(anos)
      // Mantém a semântica de ano único das telas: usa o ano mais recente com dados.
      anoUsado = doBanco.anoUsado
      brutas = doBanco.brutas.filter((e) => e.ano === anoUsado)
    } catch (e) {
      console.warn('[radar-verba] cache indisponível, fallback ao vivo:', e)
    }
    if (brutas.length === 0) {
      for (const ano of anos) {
        brutas = await buscarEmendasSaudeAno(ano)
        if (brutas.length > 0) { anoUsado = ano; break }
      }
    }

    // Capacidade de pagamento (CAPAG) do ente beneficiário entra no score da emenda.
    // Índice carregado em lote (cacheado); resolvido por UF/município da localidade do gasto.
    const capagIdx = await carregarIndiceCapag()
    let emendas: EmendaRadar[] = brutas.map((e) =>
      toEmendaRadar(e, capagIdx.resolveLocalidade(e.localidadeDoGasto)),
    )

    // Filtros
    if (ufs?.length) emendas = emendas.filter((e) => ufs.includes(e.uf))
    else if (uf) emendas = emendas.filter((e) => e.uf === uf)
    if (tipo) emendas = emendas.filter((e) => e.tipo.toLowerCase().includes(tipo))
    if (subfuncao) emendas = emendas.filter((e) => e.subfuncao.toLowerCase().includes(subfuncao))
    if (valorMin > 0) emendas = emendas.filter((e) => e.disponivel >= valorMin)
    if (soQuentes) emendas = emendas.filter((e) => e.temperatura === 'quente')

    // Ordena pela verba disponível (o "dinheiro em cima da mesa"), depois pelo score.
    emendas.sort((a, b) => b.disponivel - a.disponivel || b.score - a.score)

    const verbaDisponivel = emendas.reduce((s, e) => s + e.disponivel, 0)
    const quentes = emendas.filter((e) => e.temperatura === 'quente').length
    const municipios = new Set(emendas.map((e) => `${e.municipio}-${e.uf}`)).size

    const subfuncoes = Array.from(new Set(brutas.map((e) => e.subfuncao).filter(Boolean))).sort()
    const tipos = Array.from(new Set(brutas.map((e) => e.tipoEmenda).filter(Boolean))).sort()

    const payload = {
      kpis: {
        verbaDisponivel,
        emendasQuentes: quentes,
        municipiosComVerba: municipios,
        ticketMedioDisponivel: emendas.length ? Math.round(verbaDisponivel / emendas.length) : 0,
      },
      emendas,
      ano: anoUsado,
      total: emendas.length,
      facetas: { subfuncoes, tipos },
      fonte: 'Portal da Transparência — emendas parlamentares (Saúde)',
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, emendas.length > 0 ? TTL.LONG : TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('PORTAL_TRANSPARENCIA_API_KEY')) {
      return NextResponse.json(
        {
          error: 'API key do Portal da Transparência não configurada',
          instrucoes:
            'Cadastre-se em https://portaldatransparencia.gov.br/api-de-dados e defina PORTAL_TRANSPARENCIA_API_KEY no .env.local',
        },
        { status: 401 },
      )
    }
    console.error('[radar-verba]', error)
    return NextResponse.json({ error: 'Erro ao buscar radar de verba', detalhe: msg }, { status: 502 })
  }
}
