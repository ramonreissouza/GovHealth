// src/app/api/repasses/route.ts
// Transferências voluntárias (repasses) do Portal da Transparência.

import { NextRequest, NextResponse } from 'next/server'
import { buscarRepasses } from '@/lib/transferegov'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 3600

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase() ?? undefined
  const municipio = searchParams.get('municipio')?.trim() || undefined
  const funcao = searchParams.get('funcao') ?? undefined
  const pagina = Number(searchParams.get('pagina') ?? 1)

  const cacheKey = `repasses:${uf ?? ''}:${municipio ?? ''}:${funcao ?? ''}:${pagina}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const repasses = await buscarRepasses({ uf, municipio, funcao, pagina })
    const total = Array.isArray(repasses) ? repasses.length : 0
    const payload = {
      repasses,
      total,
      fonte: 'Portal da Transparência — transferências voluntárias',
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, total > 0 ? TTL.LONG : TTL.SHORT)
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
    console.error('[repasses]', error)
    return NextResponse.json({ error: 'Erro ao buscar repasses', detalhe: msg }, { status: 502 })
  }
}
