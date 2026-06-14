// src/app/api/emendas/detalhe/route.ts
// Detalhe de uma emenda: empenhos com favorecido (unidade contratada), órgão e objeto.

import { NextRequest, NextResponse } from 'next/server'
import { buscarDetalheEmenda } from '@/lib/emendas'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const codigo = req.nextUrl.searchParams.get('codigo')?.trim()
  if (!codigo) {
    return NextResponse.json({ error: 'Parâmetro "codigo" é obrigatório' }, { status: 400 })
  }

  const cacheKey = `emenda-detalhe:${codigo}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const detalhe = await buscarDetalheEmenda(codigo)
    setCached(cacheKey, detalhe, TTL.LONG)
    return NextResponse.json(detalhe)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('PORTAL_TRANSPARENCIA_API_KEY')) {
      return NextResponse.json(
        { error: 'API key do Portal da Transparência não configurada' },
        { status: 401 },
      )
    }
    console.error('[emenda-detalhe]', error)
    return NextResponse.json({ error: 'Erro ao buscar detalhe da emenda', detalhe: msg }, { status: 502 })
  }
}
