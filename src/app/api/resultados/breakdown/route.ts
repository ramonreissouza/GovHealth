// src/app/api/resultados/breakdown/route.ts — TELA 2
// Breakdown Item × Empresa × Estado. Colunas conectadas: ao escolher item e empresa,
// as colunas seguintes (vencedor, estado) e o KPI total se recontextualizam.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'

interface RankRow { chave: string | null; valor: number; qtd: number }

function buildWhere(opts: { ano?: number; item?: string; empresa?: string; uf?: string }) {
  const where: string[] = ['r.valor_total_homologado IS NOT NULL']
  const params: unknown[] = []
  if (opts.ano) { params.push(opts.ano); where.push(`r.ano = $${params.length}`) }
  if (opts.item) { params.push(opts.item); where.push(`r.nome_catmat = $${params.length}`) }
  if (opts.empresa) { params.push(opts.empresa); where.push(`r.nome_fornecedor = $${params.length}`) }
  if (opts.uf) { params.push(opts.uf); where.push(`r.uf = $${params.length}`) }
  return { sql: `WHERE ${where.join(' AND ')}`, params }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  const item = searchParams.get('item')?.trim() || undefined
  const empresa = searchParams.get('empresa')?.trim() || undefined
  const uf = searchParams.get('uf')?.toUpperCase().trim() || undefined

  try {
    // Coluna ITEM: ranking geral (só ano filtra), independente do item selecionado.
    const wItem = buildWhere({ ano, uf })
    // Coluna VENCEDOR: recontextualiza pelo item selecionado.
    const wVenc = buildWhere({ ano, item, uf })
    // Coluna ESTADO + KPI + proponentes: item + empresa selecionados.
    const wCtx = buildWhere({ ano, item, empresa, uf })

    const [porItem, porVencedor, porEstado, totalRow, proponentes] = await Promise.all([
      query<RankRow>(
        `SELECT COALESCE(NULLIF(r.nome_catmat,''),'(sem descrição)') AS chave,
                SUM(r.valor_total_homologado)::float8 AS valor, COUNT(*)::int AS qtd
         FROM resultados r ${wItem.sql} GROUP BY 1 ORDER BY valor DESC NULLS LAST LIMIT 25`, wItem.params),
      query<RankRow>(
        `SELECT r.nome_fornecedor AS chave,
                SUM(r.valor_total_homologado)::float8 AS valor, COUNT(*)::int AS qtd
         FROM resultados r ${wVenc.sql} GROUP BY 1 ORDER BY valor DESC NULLS LAST LIMIT 25`, wVenc.params),
      query<RankRow>(
        `SELECT r.uf AS chave,
                SUM(r.valor_total_homologado)::float8 AS valor, COUNT(*)::int AS qtd
         FROM resultados r ${wCtx.sql} GROUP BY 1 ORDER BY valor DESC NULLS LAST LIMIT 27`, wCtx.params),
      query<{ total: number }>(
        `SELECT COALESCE(SUM(r.valor_total_homologado),0)::float8 AS total
         FROM resultados r ${wCtx.sql}`, wCtx.params),
      query<RankRow>(
        `SELECT c.razao_social_orgao AS chave,
                SUM(r.valor_total_homologado)::float8 AS valor, COUNT(DISTINCT r.numero_controle_pncp)::int AS qtd
         FROM resultados r LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
         ${wCtx.sql} GROUP BY 1 ORDER BY valor DESC NULLS LAST LIMIT 25`, wCtx.params),
    ])

    return NextResponse.json({
      valorTotal: totalRow[0]?.total ?? 0,
      porItem, porVencedor, porEstado, proponentes,
      atualizadoEm: new Date().toISOString(),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('DATABASE_URL') || /relation .* does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: 'Banco não configurado/populado', instrucoes: 'Rode `npm run db:setup` e `npm run etl`.' },
        { status: 503 },
      )
    }
    console.error('[resultados/breakdown]', error)
    return NextResponse.json({ error: 'Erro ao consultar breakdown', detalhe: msg }, { status: 500 })
  }
}
