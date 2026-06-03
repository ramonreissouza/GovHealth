// src/app/api/contratos/route.ts
// Proxy com cache para o Contratos.gov.br (Comprasnet Contratos).
// ?ug=<codigoUG>  → contratos da unidade gestora
// ?cnpj=<cnpj>    → contratos do fornecedor (incumbente)

import { NextRequest, NextResponse } from 'next/server'
import { buscarContratosPorUG, buscarContratosPorFornecedor, calcularContratosStats } from '@/lib/contratos'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const ug = searchParams.get('ug')?.trim()
  const cnpj = searchParams.get('cnpj')?.replace(/\D/g, '')

  if (!ug && !cnpj) {
    return NextResponse.json(
      { error: 'Informe "ug" (código da unidade gestora) ou "cnpj" (fornecedor).' },
      { status: 400 },
    )
  }

  const cacheKey = `contratos:${ug ?? ''}:${cnpj ?? ''}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const contratos = ug
      ? await buscarContratosPorUG(ug)
      : await buscarContratosPorFornecedor(cnpj!)

    const payload = {
      contratos,
      stats: calcularContratosStats(contratos),
      fonte: 'contratos.gov.br',
      atualizadoEm: new Date().toISOString(),
    }
    // Contratos mudam pouco no dia — cache de 24h em caso de sucesso.
    setCached(cacheKey, payload, contratos.length > 0 ? TTL.LONG : TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[contratos]', error)
    return NextResponse.json(
      { error: 'Erro ao consultar o Contratos.gov.br', detalhe: String(error) },
      { status: 502 },
    )
  }
}
