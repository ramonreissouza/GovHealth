// src/app/api/emendas/route.ts
// Emendas parlamentares de saúde ("verbas quentes") via Portal da Transparência.

import { NextRequest, NextResponse } from 'next/server'
import { buscarEmendasSaude } from '@/lib/transferegov'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 7200

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase() ?? undefined
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  const pagina = Number(searchParams.get('pagina') ?? 1)

  if (!uf) {
    return NextResponse.json(
      { error: 'Parâmetro "uf" é obrigatório (a API de emendas exige filtro por UF).' },
      { status: 400 },
    )
  }

  const cacheKey = `emendas:${uf}:${ano ?? ''}:${pagina}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const emendas = await buscarEmendasSaude({ uf, ano, pagina, funcao: '10' })
    const payload = {
      emendas,
      total: emendas.length,
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
    console.error('[emendas]', error)
    return NextResponse.json({ error: 'Erro ao buscar emendas', detalhe: msg }, { status: 502 })
  }
}
