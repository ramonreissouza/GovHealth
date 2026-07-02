// src/app/api/resultados/fornecedores/route.ts — Ranking de Fornecedores (Vendedores).
// Maiores vendedores por categoria, no país todo ou por UFs selecionadas (multi).
// Com ?fornecedor=<nome> devolve o drill-down: o que ele vendeu por estado,
// por categoria e por item. Lê resultados homologados do banco (ETL).

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { CATEGORIA_KEYS, categoriaCaseSql } from '@/lib/categoria-mercado'
import { ultimaColetaResultados } from '@/lib/coleta-meta'

export const runtime = 'nodejs'

const CAT_SQL = categoriaCaseSql('r.nome_catmat')

interface RankingRow {
  fornecedor: string | null
  cnpj: string | null
  valor: number
  itens: number
  convenios: number
  ufs: number
}
interface KpiRow { valor_total: number; n_fornecedores: number; n_itens: number; n_convenios: number }
interface CatCountRow { categoria: string; n: number; valor: number }
interface UfRow { uf: string }
interface PorRow { chave: string | null; valor: number; qtd: number }
interface PorCatRow { categoria: string; valor: number; qtd: number }
interface PorItemRow { item: string; codigo_catmat: string | null; valor: number; qtd: number }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const ufParam = searchParams.get('uf')?.toUpperCase().trim() || undefined // "CE" ou "CE,BA"
  const ufs = ufParam ? ufParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  const categoriaParam = searchParams.get('categoria')?.trim().toLowerCase() || undefined
  const categoria = categoriaParam && CATEGORIA_KEYS.includes(categoriaParam as never) ? categoriaParam : undefined
  const fornecedor = searchParams.get('fornecedor')?.trim() || undefined
  const q = searchParams.get('q')?.trim() || undefined // busca por nome (ILIKE) no ranking
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 500)

  // WHERE base: uf/ano (usado nas contagens por categoria e no drill-down).
  const whereBase: string[] = ['r.valor_total_homologado IS NOT NULL']
  const baseParams: unknown[] = []
  if (ufs) { baseParams.push(ufs); whereBase.push(`r.uf = ANY($${baseParams.length})`) }
  if (ano) { baseParams.push(ano); whereBase.push(`r.ano = $${baseParams.length}`) }
  const whereBaseSql = `WHERE ${whereBase.join(' AND ')}`

  // WHERE com categoria (KPIs).
  const where = [...whereBase]
  const params = [...baseParams]
  if (categoria) { params.push(categoria); where.push(`(${CAT_SQL}) = $${params.length}`) }
  const whereSql = `WHERE ${where.join(' AND ')}`

  // WHERE do ranking: categoria + busca por nome. A busca não afeta KPIs/contagens
  // (esses refletem o escopo UF/ano/categoria), só o que aparece na lista.
  const rankWhere = [...where]
  const rankParams = [...params]
  if (q) { rankParams.push(`%${q}%`); rankWhere.push(`r.nome_fornecedor ILIKE $${rankParams.length}`) }
  const rankWhereSql = `WHERE ${rankWhere.join(' AND ')}`

  try {
    const [ranking, kpiRows, catCounts, ufsComDados] = await Promise.all([
      query<RankingRow>(
        `SELECT r.nome_fornecedor AS fornecedor,
                MAX(r.ni_fornecedor) AS cnpj,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(DISTINCT COALESCE(NULLIF(r.codigo_catmat, ''), r.nome_catmat))::int AS itens,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS convenios,
                COUNT(DISTINCT r.uf)::int AS ufs
         FROM resultados r ${rankWhereSql}
         GROUP BY r.nome_fornecedor
         ORDER BY valor DESC NULLS LAST
         LIMIT $${rankParams.length + 1}`,
        [...rankParams, limit],
      ),
      query<KpiRow>(
        `SELECT COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS valor_total,
                COUNT(DISTINCT r.nome_fornecedor)::int AS n_fornecedores,
                COUNT(DISTINCT COALESCE(NULLIF(r.codigo_catmat, ''), r.nome_catmat))::int AS n_itens,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS n_convenios
         FROM resultados r ${whereSql}`,
        params,
      ),
      query<CatCountRow>(
        `SELECT (${CAT_SQL}) AS categoria, COUNT(*)::int AS n,
                COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS valor
         FROM resultados r ${whereBaseSql} GROUP BY 1`,
        baseParams,
      ),
      query<UfRow>(`SELECT DISTINCT uf FROM resultados WHERE uf IS NOT NULL ORDER BY uf`),
    ])

    // Drill-down de um fornecedor: respeita uf/ano, ignora o filtro de categoria
    // (mostra a composição completa do que a empresa vendeu).
    let detalhe = null
    if (fornecedor) {
      const dParams = [...baseParams, fornecedor]
      const dWhere = `${whereBaseSql} AND r.nome_fornecedor = $${dParams.length}`
      const [porEstado, porCategoria, porItem] = await Promise.all([
        query<PorRow>(
          `SELECT r.uf AS chave, SUM(r.valor_total_homologado)::float8 AS valor, COUNT(*)::int AS qtd
           FROM resultados r ${dWhere} GROUP BY r.uf ORDER BY valor DESC NULLS LAST`, dParams),
        query<PorCatRow>(
          `SELECT (${CAT_SQL}) AS categoria, SUM(r.valor_total_homologado)::float8 AS valor, COUNT(*)::int AS qtd
           FROM resultados r ${dWhere} GROUP BY 1 ORDER BY valor DESC NULLS LAST`, dParams),
        query<PorItemRow>(
          `SELECT COALESCE(NULLIF(r.nome_catmat, ''), '(sem descrição)') AS item, r.codigo_catmat,
                  SUM(r.valor_total_homologado)::float8 AS valor, COUNT(*)::int AS qtd
           FROM resultados r ${dWhere} GROUP BY 1, 2 ORDER BY valor DESC NULLS LAST LIMIT 20`, dParams),
      ])
      detalhe = { fornecedor, porEstado, porCategoria, porItem }
    }

    const kpi = kpiRows[0]
    return NextResponse.json({
      escopo: ufs ? ufs.join(',') : 'BR',
      categoria: categoria ?? null,
      kpis: {
        valorTotal: kpi?.valor_total ?? 0,
        fornecedores: kpi?.n_fornecedores ?? 0,
        itens: kpi?.n_itens ?? 0,
        convenios: kpi?.n_convenios ?? 0,
      },
      ranking,
      categorias: catCounts,
      ufsComDados: ufsComDados.map((u) => u.uf),
      detalhe,
      atualizadoEm: (await ultimaColetaResultados()) ?? new Date().toISOString(),
      fonte: 'PNCP · resultados homologados',
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('DATABASE_URL') || /relation .* does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: 'Banco não configurado/populado', instrucoes: 'Rode `npm run db:setup` e `npm run etl`.' },
        { status: 503 },
      )
    }
    console.error('[resultados/fornecedores]', error)
    return NextResponse.json({ error: 'Erro ao consultar fornecedores', detalhe: msg }, { status: 500 })
  }
}
