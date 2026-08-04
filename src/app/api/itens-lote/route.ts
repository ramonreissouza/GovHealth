// src/app/api/itens-lote/route.ts
// Retorna os itens (equipamentos/acessórios) de VÁRIAS contratações de uma vez,
// direto do banco (tabela `itens`, populada pelo ETL). Uma única query em vez de
// N chamadas ao PNCP — habilita a busca por item ("luvas cirúrgicas") de forma
// instantânea e sem rate-limit, tanto em Portais Estaduais quanto em Licitações.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import type { ItemPNCP } from '@/lib/pncp'

export const runtime = 'nodejs'

interface ItemRow {
  numero_controle_pncp: string
  numero_item: number | null
  descricao: string | null
  quantidade: number | null
  valor_unitario_estimado: number | null
  codigo_pdm: number | null
  nome_pdm: string | null
}

export async function POST(req: NextRequest) {
  let ids: string[] = []
  try {
    const body = await req.json()
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === 'string') : []
  } catch {
    return NextResponse.json({ error: 'body inválido; esperado { ids: string[] }' }, { status: 400 })
  }
  // Dedup + limite defensivo (evita query gigante).
  ids = Array.from(new Set(ids)).slice(0, 400)
  if (ids.length === 0) return NextResponse.json({ itens: {} })

  const cacheKey = `itens-lote:${[...ids].sort().join('|')}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const rows = await query<ItemRow>(
      `SELECT i.numero_controle_pncp, i.numero_item, i.descricao,
              i.quantidade::float8              AS quantidade,
              i.valor_unitario_estimado::float8 AS valor_unitario_estimado,
              -- PDM do CATMAT casado por texto: é o que permite consultar o Painel
              -- de Preços por código em vez de por aproximação de termo.
              i.codigo_pdm, p.nome AS nome_pdm
         FROM itens i
         LEFT JOIN catmat_pdm p ON p.codigo_pdm = i.codigo_pdm
        WHERE i.numero_controle_pncp = ANY($1)
        ORDER BY i.numero_controle_pncp, i.numero_item`,
      [ids],
    )

    const itens: Record<string, ItemPNCP[]> = {}
    for (const r of rows) {
      ;(itens[r.numero_controle_pncp] ??= []).push({
        numeroItem: r.numero_item ?? 0,
        descricao: r.descricao ?? '',
        valorUnitarioEstimado: r.valor_unitario_estimado ?? 0,
        quantidade: r.quantidade ?? 0,
        unidadeMedida: '',
        situacaoCompraItemNome: '',
        codigoPdm: r.codigo_pdm ?? undefined,
        nomePdm: r.nome_pdm ?? undefined,
      })
    }

    const payload = { itens }
    setCached(cacheKey, payload, TTL.LONG)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[itens-lote]', error)
    return NextResponse.json({ error: String(error), itens: {} }, { status: 500 })
  }
}
