// src/app/api/cnes/estabelecimentos/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  buscarEstabelecimentosMunicipio,
  buscarEstabelecimentoPorCNPJ,
  buscarHospitaisUF,
} from '@/lib/cnes'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 86400 // 24h — CNES muda pouco

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const cnpj = searchParams.get('cnpj') ?? undefined
  const codigoMunicipio = searchParams.get('codigoMunicipio') ?? undefined
  const uf = searchParams.get('uf') ?? undefined

  const cacheKey = `cnes:${cnpj ?? ''}:${codigoMunicipio ?? ''}:${uf ?? ''}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    if (cnpj) {
      const est = await buscarEstabelecimentoPorCNPJ(cnpj)
      const payload = { estabelecimento: est, fonte: 'CNES/DATASUS' }
      setCached(cacheKey, payload, TTL.LONG)
      return NextResponse.json(payload)
    }

    if (codigoMunicipio) {
      const items = await buscarEstabelecimentosMunicipio(codigoMunicipio)
      const payload = {
        estabelecimentos: items,
        total: items.length,
        fonte: 'CNES/DATASUS',
      }
      setCached(cacheKey, payload, TTL.LONG)
      return NextResponse.json(payload)
    }

    if (uf) {
      const items = await buscarHospitaisUF(uf, 30)
      const payload = {
        estabelecimentos: items,
        total: items.length,
        fonte: 'CNES/DATASUS',
      }
      setCached(cacheKey, payload, TTL.LONG)
      return NextResponse.json(payload)
    }

    return NextResponse.json(
      { error: 'Informe cnpj, codigoMunicipio ou uf como parâmetro' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[cnes]', error)
    return NextResponse.json(
      { error: 'Erro ao consultar CNES', detalhe: String(error) },
      { status: 500 }
    )
  }
}
