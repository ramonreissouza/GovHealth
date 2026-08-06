// src/app/api/resultados/fornecedores/route.ts — Ranking de Fornecedores (Vendedores).
// Maiores vendedores por categoria, no país todo ou por UFs selecionadas (multi).
// Com ?fornecedor=<nome> devolve o drill-down: o que ele vendeu por estado,
// por categoria e por item. Lê resultados homologados do banco (ETL).

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { CATEGORIA_KEYS, categoriaSql } from '@/lib/categoria-mercado'
import { isTipoFornecimento } from '@/lib/tipo-sql'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { ultimaColetaResultados } from '@/lib/coleta-meta'
import { fornecedorKeySql, fornecedorNomeSql } from '@/lib/fornecedor-dedup'

export const runtime = 'nodejs'

const CAT_SQL = categoriaSql('r')
const FKEY = fornecedorKeySql()      // chave de dedup (CNPJ ou nome normalizado)
const FNOME = fornecedorNomeSql()    // nome canônico (grafia mais frequente)

interface RankingRow {
  fornecedor: string | null
  chave: string | null
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
interface BreakdownItemRow {
  fornecedor: string | null
  cnpj: string | null
  item: string
  codigo_catmat: string | null
  quantidade: number | null
  valor_unitario: number | null
  valor_total: number | null
  convenios: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const ufParam = searchParams.get('uf')?.toUpperCase().trim() || undefined // "CE" ou "CE,BA"
  const ufs = ufParam ? ufParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  // categoria aceita múltiplas (separadas por vírgula) — pré-filtro pelas categorias
  // de interesse do Setup da Empresa (item 9). Mantém retrocompat com valor único.
  const categoriaParam = searchParams.get('categoria')?.trim().toLowerCase() || undefined
  const categorias = categoriaParam
    ? [...new Set(categoriaParam.split(',').map((s) => s.trim()).filter((c) => CATEGORIA_KEYS.includes(c as never)))]
    : []
  const tipoParam = searchParams.get('tipo')?.trim().toLowerCase() || undefined
  const tipo = tipoParam && tipoParam !== 'todos' && isTipoFornecimento(tipoParam) ? tipoParam : undefined
  const fornecedor = searchParams.get('fornecedor')?.trim() || undefined // legado: nome
  const chave = searchParams.get('chave')?.trim() || undefined           // preferido: chave de dedup
  const q = searchParams.get('q')?.trim() || undefined // busca por nome (ILIKE) no ranking
  const formato = searchParams.get('formato')?.trim().toLowerCase() || undefined // 'itens' = breakdown p/ export
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 500)
  // Paginação de verdade: o ranking passou a ter páginas, e o total para montar a
  // régua já existia — é o n_fornecedores do bloco de KPIs, calculado sobre o mesmo
  // filtro. Sem OFFSET a tela só sabia mostrar o topo da lista.
  const offset = Math.max(0, Number(searchParams.get('offset') ?? 0))

  // Cache por assinatura de parâmetros (repetir o mesmo filtro fica instantâneo).
  const cacheKey = `forn:${ufParam ?? ''}:${ano ?? ''}:${categorias.join('+')}:${tipo ?? ''}:${fornecedor ?? ''}:${chave ?? ''}:${q ?? ''}:${formato ?? ''}:${limit}:${offset}`
  const cachedResp = getCached<object>(cacheKey)
  if (cachedResp) return NextResponse.json(cachedResp)

  // WHERE base: uf/ano/tipo (usado nas contagens por categoria e no drill-down).
  const whereBase: string[] = ['r.valor_total_homologado IS NOT NULL']
  const baseParams: unknown[] = []
  if (ufs) { baseParams.push(ufs); whereBase.push(`r.uf = ANY($${baseParams.length})`) }
  if (ano) { baseParams.push(ano); whereBase.push(`r.ano = $${baseParams.length}`) }
  if (tipo) { baseParams.push(tipo); whereBase.push(`r.tipo_fornecimento = $${baseParams.length}`) }
  const whereBaseSql = `WHERE ${whereBase.join(' AND ')}`

  // WHERE com categoria (KPIs). Uma ou mais categorias de mercado.
  const where = [...whereBase]
  const params = [...baseParams]
  if (categorias.length) { params.push(categorias); where.push(`(${CAT_SQL}) = ANY($${params.length})`) }
  const whereSql = `WHERE ${where.join(' AND ')}`

  // WHERE do ranking: categoria + busca por nome. A busca não afeta KPIs/contagens
  // (esses refletem o escopo UF/ano/categoria), só o que aparece na lista.
  const rankWhere = [...where]
  const rankParams = [...params]
  if (q) { rankParams.push(`%${q}%`); rankWhere.push(`r.nome_fornecedor ILIKE $${rankParams.length}`) }
  const rankWhereSql = `WHERE ${rankWhere.join(' AND ')}`

  // ── Export "itens": breakdown por (fornecedor, item) com quantidade, valor
  // total e valor unitário. Reflete os filtros atuais (uf/ano/categoria + busca).
  if (formato === 'itens') {
    try {
      const itens = await query<BreakdownItemRow>(
        `SELECT ${FNOME} AS fornecedor,
                MAX(r.ni_fornecedor) AS cnpj,
                COALESCE(NULLIF(r.nome_catmat, ''), '(sem descrição)') AS item,
                r.codigo_catmat,
                SUM(r.quantidade_homologada)::float8 AS quantidade,
                (SUM(r.valor_total_homologado) / NULLIF(SUM(r.quantidade_homologada), 0))::float8 AS valor_unitario,
                SUM(r.valor_total_homologado)::float8 AS valor_total,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS convenios
         FROM resultados r ${rankWhereSql}
         GROUP BY ${FKEY}, item, r.codigo_catmat
         ORDER BY valor_total DESC NULLS LAST
         LIMIT 5000`,
        rankParams,
      )
      const payload = { formato: 'itens', itens }
      setCached(cacheKey, payload, TTL.SHORT)
      return NextResponse.json(payload)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[resultados/fornecedores:itens]', error)
      return NextResponse.json({ error: 'Erro ao gerar breakdown de itens', detalhe: msg }, { status: 500 })
    }
  }

  try {
    const [ranking, kpiRows, catCounts, ufsComDados] = await Promise.all([
      query<RankingRow>(
        `SELECT ${FNOME} AS fornecedor,
                ${FKEY} AS chave,
                MAX(r.ni_fornecedor) AS cnpj,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(DISTINCT COALESCE(NULLIF(r.codigo_catmat, ''), r.nome_catmat))::int AS itens,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS convenios,
                COUNT(DISTINCT r.uf)::int AS ufs
         FROM resultados r ${rankWhereSql}
         GROUP BY ${FKEY}
         ORDER BY valor DESC NULLS LAST
         LIMIT $${rankParams.length + 1} OFFSET $${rankParams.length + 2}`,
        [...rankParams, limit, offset],
      ),
      query<KpiRow>(
        `SELECT COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS valor_total,
                COUNT(DISTINCT ${FKEY})::int AS n_fornecedores,
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
    if (chave || fornecedor) {
      const dParams = [...baseParams]
      let dWhere: string
      if (chave) { dParams.push(chave); dWhere = `${whereBaseSql} AND ${FKEY} = $${dParams.length}` }
      else { dParams.push(fornecedor); dWhere = `${whereBaseSql} AND TRIM(r.nome_fornecedor) = $${dParams.length}` }
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
      detalhe = { fornecedor: fornecedor ?? chave, porEstado, porCategoria, porItem }
    }

    const kpi = kpiRows[0]
    const payload = {
      escopo: ufs ? ufs.join(',') : 'BR',
      categoria: categorias.length ? categorias.join(',') : null,
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
    }
    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
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
