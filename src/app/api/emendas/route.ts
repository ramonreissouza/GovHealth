// src/app/api/emendas/route.ts
// Emendas parlamentares de saúde ("verbas quentes") via Portal da Transparência.
// Usa a fonte tipada (emendas.ts: filtro exato funcao="Saúde"), com fallback de ano —
// as emendas de saúde do ano corrente costumam ser esparsas nas primeiras páginas.

import { NextRequest, NextResponse } from 'next/server'
import { buscarEmendasSaudeAno, parseValorBR, type EmendaParlamentar } from '@/lib/emendas'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 7200
export const maxDuration = 30

export interface EmendaView extends EmendaParlamentar {
  empenhado: number
  pago: number
  pctExecucao: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase().trim() || undefined
  const anoParam = searchParams.get('ano')

  const cacheKey = `emendas:${anoParam ?? 'auto'}:${uf ?? ''}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const anoAtual = new Date().getFullYear()
    const anos = anoParam ? [Number(anoParam)] : [anoAtual, anoAtual - 1, anoAtual - 2]

    let emendas: EmendaParlamentar[] = []
    let anoUsado = anos[0]
    for (const ano of anos) {
      emendas = await buscarEmendasSaudeAno(ano, 8)
      if (emendas.length > 0) { anoUsado = ano; break }
    }

    // Filtro opcional por UF — a localidade do gasto inclui a sigla (ex.: "São Paulo (SP)").
    if (uf) {
      emendas = emendas.filter((e) => (e.localidadeDoGasto ?? '').toUpperCase().includes(uf))
    }

    const itens: EmendaView[] = emendas
      .map((e) => {
        const empenhado = parseValorBR(e.valorEmpenhado)
        const pago = parseValorBR(e.valorPago)
        return { ...e, empenhado, pago, pctExecucao: empenhado > 0 ? Math.round((pago / empenhado) * 100) : 0 }
      })
      .sort((a, b) => b.empenhado - a.empenhado)

    const totalEmpenhado = itens.reduce((s, e) => s + e.empenhado, 0)
    const totalPago = itens.reduce((s, e) => s + e.pago, 0)

    const payload = {
      emendas: itens,
      ano: anoUsado,
      total: itens.length,
      totalEmpenhado,
      totalPago,
      pctExecucaoGeral: totalEmpenhado > 0 ? Math.round((totalPago / totalEmpenhado) * 100) : 0,
      fonte: 'Portal da Transparência — emendas parlamentares (Saúde)',
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, itens.length > 0 ? TTL.LONG : TTL.SHORT)
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
    console.error('[emendas]', error)
    return NextResponse.json({ error: 'Erro ao buscar emendas', detalhe: msg }, { status: 502 })
  }
}
