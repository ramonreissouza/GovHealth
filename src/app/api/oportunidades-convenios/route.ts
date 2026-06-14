// src/app/api/oportunidades-convenios/route.ts
// Oportunidades geradas a partir de convênios de saúde + score engine,
// com boost para municípios que têm emendas parlamentares de saúde.

import { NextRequest, NextResponse } from 'next/server'
import {
  buscarConveniosSaudeUF,
  buscarConveniosSaudeNacional,
  getMunicipiosComEmendasSaude,
} from '@/lib/transferegov'
import { gerarOportunidadesDeConvenios } from '@/lib/score-engine'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 1800
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase() ?? undefined
  const minScore = Number(searchParams.get('minScore') ?? 0)
  const limit = Number(searchParams.get('limit') ?? 100)

  const cacheKey = `oport-convenios:${uf ?? ''}:${minScore}:${limit}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const convenios = uf
      ? await buscarConveniosSaudeUF(uf)
      : await buscarConveniosSaudeNacional()

    // O boost de emendas exige UF (a API de emendas filtra por UF).
    const municipiosComEmendas = uf
      ? await getMunicipiosComEmendasSaude(uf)
      : new Set<string>()

    let oportunidades = gerarOportunidadesDeConvenios(convenios, {}, municipiosComEmendas)
    if (minScore > 0) oportunidades = oportunidades.filter((o) => o.score >= minScore)
    oportunidades = oportunidades.slice(0, limit)

    const payload = {
      oportunidades,
      kpis: {
        total: oportunidades.length,
        quentes: oportunidades.filter((o) => o.status === 'quente').length,
        valorTotal: oportunidades.reduce((s, o) => s + o.valorEstimado, 0),
        scoreMedio: oportunidades.length
          ? Math.round(oportunidades.reduce((s, o) => s + o.score, 0) / oportunidades.length)
          : 0,
      },
      municipiosComEmenda: municipiosComEmendas.size,
      fonte: 'TransfereGov (convênios) + emendas parlamentares + score engine',
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, TTL.SHORT)
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
    console.error('[oportunidades-convenios]', error)
    return NextResponse.json(
      { error: 'Erro ao gerar oportunidades de convênios', detalhe: msg },
      { status: 502 },
    )
  }
}
