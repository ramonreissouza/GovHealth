// src/app/api/resultados/vencedores/route.ts — TELA 1 (Análise de Vencedores)
// Lê resultados homologados do banco (populado pelo ETL). Não chama o PNCP ao vivo.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { CATEGORIA_KEYS, categoriaCaseSql } from '@/lib/categoria-mercado'

export const runtime = 'nodejs'

const CAT_SQL = categoriaCaseSql('r.nome_catmat')

interface VencedorRow {
  proponente: string | null
  convenio: string
  vencedor: string | null
  codigo_catmat: string | null
  nome_catmat: string | null
  categoria: string | null
  qtd: number | null
  valor: number | null
  uf: string | null
  ano: number | null
}

interface CatCountRow {
  categoria: string
  n: number
  valor: number
}

interface KpiRow {
  valor_total: number
  convenios: number
  itens_unicos: number
  consumidores: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase().trim() || undefined        // "CE" ou "CE,BA"
  const empresa = searchParams.get('empresa')?.trim() || undefined
  const dataIni = searchParams.get('dataIni') || undefined                     // YYYY-MM-DD
  const dataFim = searchParams.get('dataFim') || undefined
  const categoriaParam = searchParams.get('categoria')?.trim().toLowerCase() || undefined
  const categoria = categoriaParam && CATEGORIA_KEYS.includes(categoriaParam as never) ? categoriaParam : undefined
  const limit = Math.min(Number(searchParams.get('limit') ?? 500), 2000)

  // WHERE base (UF/empresa/datas) — usado nas contagens por categoria.
  const whereBase: string[] = ['r.valor_total_homologado IS NOT NULL']
  const baseParams: unknown[] = []
  if (uf) { baseParams.push(uf.split(',')); whereBase.push(`r.uf = ANY($${baseParams.length})`) }
  if (empresa) { baseParams.push(`%${empresa}%`); whereBase.push(`r.nome_fornecedor ILIKE $${baseParams.length}`) }
  if (dataIni) { baseParams.push(dataIni); whereBase.push(`r.data_resultado >= $${baseParams.length}`) }
  if (dataFim) { baseParams.push(dataFim); whereBase.push(`r.data_resultado <= $${baseParams.length}`) }
  const whereBaseSql = `WHERE ${whereBase.join(' AND ')}`

  // WHERE com o filtro de categoria aplicado (KPIs + listagem).
  const where = [...whereBase]
  const params = [...baseParams]
  if (categoria) { params.push(categoria); where.push(`(${CAT_SQL}) = $${params.length}`) }
  const whereSql = `WHERE ${where.join(' AND ')}`

  try {
    // Contagem por categoria (respeita UF/empresa/datas, ignora o filtro de categoria).
    const catCounts = await query<CatCountRow>(
      `SELECT (${CAT_SQL}) AS categoria, COUNT(*)::int AS n,
              COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS valor
       FROM resultados r
       ${whereBaseSql}
       GROUP BY 1`,
      baseParams,
    )

    const [kpi] = await query<KpiRow>(
      `SELECT
         COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS valor_total,
         COUNT(DISTINCT r.numero_controle_pncp)             AS convenios,
         COUNT(DISTINCT COALESCE(NULLIF(r.codigo_catmat, ''), r.nome_catmat)) AS itens_unicos,
         COUNT(DISTINCT c.cnpj_orgao)                       AS consumidores
       FROM resultados r
       LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
       ${whereSql}`,
      params,
    )

    const vencedores = await query<VencedorRow>(
      `SELECT
         c.razao_social_orgao        AS proponente,
         r.numero_controle_pncp      AS convenio,
         r.nome_fornecedor           AS vencedor,
         r.codigo_catmat,
         r.nome_catmat,
         (${CAT_SQL})                AS categoria,
         r.quantidade_homologada::float8 AS qtd,
         r.valor_total_homologado::float8 AS valor,
         r.uf,
         r.ano
       FROM resultados r
       LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
       ${whereSql}
       ORDER BY r.valor_total_homologado DESC NULLS LAST
       LIMIT $${params.length + 1}`,
      [...params, limit],
    )

    const valorTotal = kpi?.valor_total ?? 0
    const convenios = Number(kpi?.convenios ?? 0)

    return NextResponse.json({
      kpis: {
        valorTotal,
        ticketMedio: convenios > 0 ? Math.round(valorTotal / convenios) : 0,
        itensUnicos: Number(kpi?.itens_unicos ?? 0),
        convenios,
        consumidores: Number(kpi?.consumidores ?? 0),
      },
      vencedores,
      categorias: catCounts,
      total: vencedores.length,
      atualizadoEm: new Date().toISOString(),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('DATABASE_URL')) {
      return NextResponse.json(
        { error: 'Banco não configurado', instrucoes: 'Defina DATABASE_URL (Neon) no .env.local e rode `npm run db:setup` + `npm run etl`.' },
        { status: 503 },
      )
    }
    if (/relation .* does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: 'Schema ausente', instrucoes: 'Rode `npm run db:setup` para criar as tabelas e `npm run etl` para popular.' },
        { status: 503 },
      )
    }
    console.error('[resultados/vencedores]', error)
    return NextResponse.json({ error: 'Erro ao consultar vencedores', detalhe: msg }, { status: 500 })
  }
}
