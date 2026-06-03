// src/app/api/itens/route.ts
// Retorna itens individuais de uma compra PNCP

import { NextRequest, NextResponse } from 'next/server'
import { buscarItensCompra } from '@/lib/pncp'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 3600

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const cnpj = searchParams.get('cnpj')
  const ano = Number(searchParams.get('ano'))
  const seq = Number(searchParams.get('seq'))

  if (!cnpj || !ano || !seq) {
    return NextResponse.json({ error: 'cnpj, ano e seq são obrigatórios' }, { status: 400 })
  }

  const cacheKey = `itens:${cnpj}:${ano}:${seq}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const itens = await buscarItensCompra(cnpj, ano, seq)
    const payload = { itens }
    setCached(cacheKey, payload, TTL.LONG)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[itens]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
