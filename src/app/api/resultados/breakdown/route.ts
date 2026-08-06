// src/app/api/resultados/breakdown/route.ts — TELA 2
// Breakdown Item × Empresa × Estado. Colunas conectadas: ao escolher item e empresa,
// as colunas seguintes (vencedor, estado) e o KPI total se recontextualizam.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { CATEGORIA_KEYS, categoriaSql } from '@/lib/categoria-mercado'

export const runtime = 'nodejs'

const CAT_SQL = categoriaSql('r')

interface RankRow { chave: string | null; valor: number; qtd: number }
interface DetalheRow {
  processo: string | null    // nº de controle PNCP do processo
  orgao: string | null
  uf: string | null
  fornecedor: string | null
  descricao: string | null   // texto do item: marca/modelo/especificação
  qtd: number | null
  valor_unitario: number | null
  valor_total: number | null
  data: string | null
}

function buildWhere(opts: { ano?: number; item?: string; empresa?: string; ufs?: string[]; categorias?: string[] }) {
  const where: string[] = ['r.valor_total_homologado IS NOT NULL']
  const params: unknown[] = []
  if (opts.ano) { params.push(opts.ano); where.push(`r.ano = $${params.length}`) }
  if (opts.item) { params.push(opts.item); where.push(`r.nome_catmat = $${params.length}`) }
  if (opts.empresa) { params.push(opts.empresa); where.push(`r.nome_fornecedor = $${params.length}`) }
  if (opts.ufs && opts.ufs.length) { params.push(opts.ufs); where.push(`r.uf = ANY($${params.length})`) }
  if (opts.categorias && opts.categorias.length) { params.push(opts.categorias); where.push(`(${CAT_SQL}) = ANY($${params.length})`) }
  return { sql: `WHERE ${where.join(' AND ')}`, params }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  const item = searchParams.get('item')?.trim() || undefined
  const empresa = searchParams.get('empresa')?.trim() || undefined
  const ufParam = searchParams.get('uf')?.toUpperCase().trim() || undefined // "SP" ou "SP,MG"
  const ufs = ufParam ? [...new Set(ufParam.split(',').map((s) => s.trim()).filter(Boolean))] : undefined
  // categoria (múltipla) — pré-filtro pelas categorias de interesse do Setup (item 12).
  const categoriaParam = searchParams.get('categoria')?.trim().toLowerCase() || undefined
  const categorias = categoriaParam
    ? [...new Set(categoriaParam.split(',').map((s) => s.trim()).filter((c) => CATEGORIA_KEYS.includes(c as never)))]
    : []

  try {
    // Coluna ITEM: ranking geral (ano/uf/categoria), independente do item selecionado.
    const wItem = buildWhere({ ano, ufs, categorias })
    // Coluna VENCEDOR: recontextualiza pelo item selecionado.
    const wVenc = buildWhere({ ano, item, ufs, categorias })
    // Coluna ESTADO + KPI + proponentes: item + empresa selecionados.
    const wCtx = buildWhere({ ano, item, empresa, ufs, categorias })

    // DETALHE DE COMPRA (drill mais fundo): itens homologados individuais com a
    // descrição do item (marca/modelo/especificação), o nº do processo (PNCP) e o
    // preço unitário pago. Aparece ao selecionar um item OU uma empresa (senão seria
    // amplo/pesado demais).
    const detalhePromise = (item || empresa)
      ? query<DetalheRow>(
          `SELECT r.numero_controle_pncp AS processo,
                  c.razao_social_orgao AS orgao, r.uf, r.nome_fornecedor AS fornecedor,
                  COALESCE(NULLIF(i.descricao, ''), r.nome_catmat) AS descricao,
                  r.quantidade_homologada::float8     AS qtd,
                  r.valor_unitario_homologado::float8 AS valor_unitario,
                  r.valor_total_homologado::float8    AS valor_total,
                  to_char(r.data_resultado, 'YYYY-MM-DD') AS data
           FROM resultados r
           LEFT JOIN itens i ON i.numero_controle_pncp = r.numero_controle_pncp AND i.numero_item = r.numero_item
           LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
           ${wCtx.sql}
           ORDER BY r.valor_total_homologado DESC NULLS LAST
           LIMIT 80`, wCtx.params)
      : Promise.resolve([] as DetalheRow[])

    const [porItem, porVencedor, porEstado, totalRow, proponentes, detalhes] = await Promise.all([
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
      detalhePromise,
    ])

    return NextResponse.json({
      valorTotal: totalRow[0]?.total ?? 0,
      porItem, porVencedor, porEstado, proponentes, detalhes,
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
