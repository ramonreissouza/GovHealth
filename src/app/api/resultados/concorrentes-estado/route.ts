// src/app/api/resultados/concorrentes-estado/route.ts — TELA 4
// Concorrentes por estado e equipamento. Lê resultados homologados do banco.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'

interface Top3Row { vencedor: string | null; valor: number; item: string | null }
interface ItemRow { item: string; valor: number; qtd: number }
interface EntidadeRow { entidade: string | null; valor: number; convenios: number }
interface UfRow { uf: string }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase().trim() || undefined
  const item = searchParams.get('item')?.trim() || undefined
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined

  const where: string[] = ['r.valor_total_homologado IS NOT NULL']
  const params: unknown[] = []
  if (uf) { params.push(uf); where.push(`r.uf = $${params.length}`) }
  if (ano) { params.push(ano); where.push(`r.ano = $${params.length}`) }
  if (item) { params.push(`%${item}%`); where.push(`r.nome_catmat ILIKE $${params.length}`) }
  const whereSql = `WHERE ${where.join(' AND ')}`

  try {
    const [top3, distribuicaoItens, entidades, ufsComDados] = await Promise.all([
      query<Top3Row>(
        `SELECT r.nome_fornecedor AS vencedor,
                SUM(r.valor_total_homologado)::float8 AS valor,
                (array_agg(r.nome_catmat ORDER BY r.valor_total_homologado DESC NULLS LAST))[1] AS item
         FROM resultados r ${whereSql}
         GROUP BY r.nome_fornecedor
         ORDER BY valor DESC NULLS LAST
         LIMIT 3`, params),
      query<ItemRow>(
        `SELECT COALESCE(NULLIF(r.nome_catmat, ''), '(sem descrição)') AS item,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(*)::int AS qtd
         FROM resultados r ${whereSql}
         GROUP BY 1
         ORDER BY valor DESC NULLS LAST
         LIMIT 14`, params),
      query<EntidadeRow>(
        `SELECT c.razao_social_orgao AS entidade,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS convenios
         FROM resultados r
         LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
         ${whereSql}
         GROUP BY c.razao_social_orgao
         ORDER BY valor DESC NULLS LAST
         LIMIT 30`, params),
      query<UfRow>(`SELECT DISTINCT uf FROM resultados WHERE uf IS NOT NULL ORDER BY uf`),
    ])

    const totalDist = distribuicaoItens.reduce((s, d) => s + (d.valor ?? 0), 0)
    const distribuicao = distribuicaoItens.map((d) => ({
      ...d,
      pct: totalDist > 0 ? Math.round((d.valor / totalDist) * 1000) / 10 : 0,
    }))

    return NextResponse.json({
      uf: uf ?? null,
      top3,
      distribuicaoItens: distribuicao,
      entidades,
      ufsComDados: ufsComDados.map((u) => u.uf),
      valorTotal: entidades.reduce((s, e) => s + (e.valor ?? 0), 0),
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
    console.error('[resultados/concorrentes-estado]', error)
    return NextResponse.json({ error: 'Erro ao consultar concorrentes', detalhe: msg }, { status: 500 })
  }
}
