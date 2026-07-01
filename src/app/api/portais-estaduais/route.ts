// src/app/api/portais-estaduais/route.ts
// Agrega dados de licitações de saúde dos portais estaduais (SP, RJ, MG, BA)

import { NextRequest, NextResponse } from 'next/server'
import {
  buscarLicitacoesEstado,
  buscarResumoEstados,
  PORTAIS_CONFIG,
  TODAS_UFS,
  type UFEstadual,
} from '@/lib/portais-estaduais'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'

const UFS_VALIDOS = new Set<string>(TODAS_UFS)

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf  = searchParams.get('uf')?.toUpperCase()
  const all = searchParams.get('all') === '1'

  // ── Resumo de todos os estados ────────────────────────────────────────────
  if (all || !uf) {
    const cacheKey = 'portais-estaduais:resumo'
    const cached = getCached<object>(cacheKey)
    if (cached) return NextResponse.json(cached)

    try {
      const resumo = await buscarResumoEstados()
      // Injeta configs para o frontend
      const payload = {
        ...resumo,
        portais: PORTAIS_CONFIG,
        fonte: 'PNCP (nacional)',
        atualizadoEm: new Date().toISOString(),
      }
      setCached(cacheKey, payload, TTL.SHORT)
      return NextResponse.json(payload)
    } catch (error) {
      console.error('[portais-estaduais/resumo]', error)
      return NextResponse.json(
        { error: 'Erro ao buscar resumo dos estados', detalhe: String(error) },
        { status: 500 }
      )
    }
  }

  // ── Detalhe de um estado específico ──────────────────────────────────────
  if (!uf || !UFS_VALIDOS.has(uf)) {
    return NextResponse.json(
      { error: `UF inválida: "${uf}". Use uma das 27 UFs (ex: SP, RJ, MG, BA, PR, RS...).` },
      { status: 400 }
    )
  }

  const cacheKey = `portais-estaduais:${uf}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const resultado = await buscarLicitacoesEstado(uf as UFEstadual)
    setCached(cacheKey, resultado, TTL.SHORT)
    return NextResponse.json(resultado)
  } catch (error) {
    console.error(`[portais-estaduais/${uf}]`, error)
    return NextResponse.json(
      { error: `Erro ao buscar dados de ${uf}`, detalhe: String(error) },
      { status: 500 }
    )
  }
}
