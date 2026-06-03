// src/app/api/dou/avisos/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { buscarAvisosLicitacaoSaude, buscarPreEditaisSaude } from '@/lib/dou'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const revalidate = 3600 // 1h

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const tipo = searchParams.get('tipo') ?? 'todos' // 'todos' | 'pre-edital'
  const dias = Number(searchParams.get('dias') ?? 3)

  const cacheKey = `dou:${tipo}:${dias}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const avisos =
      tipo === 'pre-edital'
        ? await buscarPreEditaisSaude()
        : await buscarAvisosLicitacaoSaude(Math.min(dias, 7))

    const payload = {
      avisos,
      total: avisos.length,
      comValor: avisos.filter((a) => a.valorEstimado != null).length,
      atualizadoEm: new Date().toISOString(),
      fonte: 'DOU/Portal da Transparência',
    }

    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[dou]', error)
    return NextResponse.json(
      { error: 'Erro ao consultar DOU', detalhe: String(error) },
      { status: 500 }
    )
  }
}
