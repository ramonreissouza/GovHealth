// src/app/api/itens-pncp/route.ts
// Fallback AO VIVO dos itens de UMA licitação, direto do PNCP.
// A rota /api/itens-lote lê os itens do banco (ETL). Nem toda licitação tem seus
// itens no banco — em especial as dos Portais Estaduais (ex.: DF), que entram por
// outro fluxo. Quando o usuário expande uma dessas, buscamos os itens ao vivo no
// PNCP para não "morrer" num "itens não disponíveis". Uma licitação por chamada
// (on-demand, ao expandir), com cache — sem rate-limit de lote.

import { NextRequest, NextResponse } from 'next/server'
import { buscarItensCompra, type ItemPNCP } from '@/lib/pncp'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export const runtime = 'nodejs'
export const maxDuration = 20

// numero_controle_pncp: "00360305000104-1-000566/2026" → cnpj / seq / ano
const CONTROLE = /^(\d{14})-\d+-(\d+)\/(\d{4})$/

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  const m = CONTROLE.exec(id)
  if (!m) {
    return NextResponse.json(
      { error: 'id inválido; esperado nº de controle PNCP (ex.: 00360305000104-1-000566/2026)', itens: [] },
      { status: 400 },
    )
  }
  const [, cnpj, seqStr, anoStr] = m

  const cacheKey = `itens-pncp:${id}`
  const cached = getCached<{ itens: ItemPNCP[] }>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const itens = await buscarItensCompra(cnpj, Number(anoStr), Number(seqStr))
    const payload = { itens }
    // Só cacheia longo quando encontrou algo; vazio pode ser transitório (rate-limit).
    setCached(cacheKey, payload, itens.length > 0 ? TTL.LONG : TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[itens-pncp]', error)
    return NextResponse.json({ error: String(error), itens: [] }, { status: 502 })
  }
}
