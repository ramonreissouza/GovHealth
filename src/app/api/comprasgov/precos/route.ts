// src/app/api/comprasgov/precos/route.ts
// Painel de Preços do Compras.gov.br — proxy com cache

import { NextRequest, NextResponse } from 'next/server'
import {
  buscarPrecosSaude,
  calcularEstatisticas,
} from '@/lib/comprasgov'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { MOCK_PRECOS } from '@/lib/mock-data'

export const runtime = 'nodejs'
export const maxDuration = 60 // resolução PDM + consultas de preço com throttling

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const descricao   = searchParams.get('descricao') ?? ''
  const uf          = searchParams.get('uf') ?? undefined
  const esfera      = searchParams.get('esfera') ?? undefined  // Federal | Estadual | Municipal
  const dataInicial = searchParams.get('dataInicial') ?? undefined
  const dataFinal   = searchParams.get('dataFinal') ?? undefined
  const codigoItem  = searchParams.get('codigoItem') ?? undefined
  const tamanhoPagina = Number(searchParams.get('tamanhoPagina') ?? 100)

  if (!descricao && !codigoItem) {
    return NextResponse.json(
      { error: 'Parâmetro "descricao" ou "codigoItem" é obrigatório' },
      { status: 400 }
    )
  }

  const cacheKey = `comprasgov:precos:${descricao}:${uf ?? ''}:${esfera ?? ''}:${dataInicial ?? ''}:${dataFinal ?? ''}:${codigoItem ?? ''}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    let precos = await buscarPrecosSaude(descricao, uf, {
      codigoItem, esfera, dataInicial, dataFinal, tamanhoPagina,
    })

    // Fallback: se a API não retornou nada, filtra o dataset local pelo termo buscado
    let usouFallback = false
    if (precos.length === 0) {
      const termo = (descricao || '').toLowerCase()
      precos = MOCK_PRECOS.filter(
        (p) =>
          !termo ||
          p.descricaoItem.toLowerCase().includes(termo) ||
          p.codigoItem.includes(termo)
      )
      usouFallback = true
    }

    const estatisticas = calcularEstatisticas(precos)

    const payload = {
      precos,
      estatisticas,
      fonte: usouFallback ? 'local' : 'comprasgov',
      atualizadoEm: new Date().toISOString(),
    }

    // Resultado real é estático (cache 24h); resultado vazio/fallback expira rápido
    setCached(cacheKey, payload, precos.length > 0 && !usouFallback ? TTL.LONG : TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[comprasgov/precos]', error)
    return NextResponse.json(
      { error: 'Erro ao buscar preços', detalhe: String(error) },
      { status: 500 }
    )
  }
}
