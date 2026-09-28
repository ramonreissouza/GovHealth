// src/app/api/contratos/route.ts
// Proxy com cache para o Contratos.gov.br (Comprasnet Contratos).
// ?ug=<codigoUG>  → contratos da unidade gestora
// ?cnpj=<cnpj>    → contratos do fornecedor (incumbente)

import { NextRequest, NextResponse } from 'next/server'
import { buscarContratosPorUG, buscarContratosPorFornecedor, calcularContratosStats } from '@/lib/contratos'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
// 30s não cobria nem duas páginas lentas do PNCP; a lib agora pagina com orçamento
// próprio e devolve parcial antes disso estourar.
export const maxDuration = 300

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
    // Por UG o universo é a própria resposta; por CNPJ o PNCP declara um total que
    // pode ser maior que o que coube nas páginas lidas — e isso vai para a tela.
    const res = ug
      ? { contratos: await buscarContratosPorUG(ug), totalNoPncp: 0, truncado: false }
      : await buscarContratosPorFornecedor(cnpj!)
    const contratos = res.contratos

    const payload = {
      contratos,
      stats: calcularContratosStats(contratos),
      truncado: res.truncado,
      totalNaFonte: res.totalNoPncp || contratos.length,
      fonte: ug ? 'Contratos.gov.br (Comprasnet)' : 'PNCP — Portal Nacional de Contratações Públicas',
      atualizadoEm: new Date().toISOString(),
    }
    // Contratos mudam pouco no dia: 24 h só para a paginação CONCLUÍDA. Um recorte
    // (página que falhou, prazo que acabou) ficava congelado 24 h mesmo com o PNCP
    // de volta um minuto depois (revisão da #45); ele fica no TTL curto.
    setCached(cacheKey, payload, contratos.length > 0 && !res.truncado ? TTL.LONG : TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[contratos]', error)
    // Mensagem específica quando a lib já traz uma (ex.: PNCP indisponível / CNPJ inválido).
    const msg = error instanceof Error ? error.message : ''
    const fonte = ug ? 'o Contratos.gov.br' : 'o PNCP'
    return NextResponse.json(
      { error: msg || `Erro ao consultar ${fonte}. Tente novamente em instantes.`, detalhe: String(error) },
      { status: 502 },
    )
  }
}
