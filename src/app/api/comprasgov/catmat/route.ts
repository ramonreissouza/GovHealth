// src/app/api/comprasgov/catmat/route.ts
// CATMAT — Catálogo de Materiais do Compras.gov.br

import { NextRequest, NextResponse } from 'next/server'
import { buscarMaterialCATMAT } from '@/lib/comprasgov'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const descricao      = searchParams.get('descricao') ?? ''
  const status         = searchParams.get('status') ?? 'ATIVO'
  const tamanhoPagina  = Number(searchParams.get('tamanhoPagina') ?? 50)

  if (!descricao) {
    return NextResponse.json(
      { error: 'Parâmetro "descricao" é obrigatório' },
      { status: 400 }
    )
  }

  const cacheKey = `comprasgov:catmat:${descricao}:${status}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const materiais = await buscarMaterialCATMAT(descricao, { status, tamanhoPagina })

    const payload = {
      materiais,
      total: materiais.length,
      atualizadoEm: new Date().toISOString(),
    }

    // CATMAT é estático — cache de 24h
    setCached(cacheKey, payload, TTL.LONG)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[comprasgov/catmat]', error)
    return NextResponse.json(
      { error: 'Erro ao buscar CATMAT', detalhe: String(error) },
      { status: 500 }
    )
  }
}
