// src/app/api/resultados/concorrentes-estado/route.ts — TELA 4
// Concorrentes por estado e equipamento. Lê resultados homologados do banco.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { CATEGORIA_KEYS, categoriaCaseSql } from '@/lib/categoria-mercado'
import { ultimaColetaResultados } from '@/lib/coleta-meta'
import { fornecedorKeySql, fornecedorNomeSql } from '@/lib/fornecedor-dedup'

export const runtime = 'nodejs'

const CAT_SQL = categoriaCaseSql('r.nome_catmat')
const FKEY = fornecedorKeySql()
const FNOME = fornecedorNomeSql()

interface ConcorrenteRow { vencedor: string | null; chave: string | null; valor: number; item: string | null; convenios: number }
interface ItemRow { item: string; valor: number; qtd: number }
interface EntidadeRow { entidade: string | null; valor: number; convenios: number }
interface UfRow { uf: string }
interface CatCountRow { categoria: string; n: number; valor: number }
interface BreakdownRow {
  processo: string | null; item: string; entidade: string | null
  qtd: number | null; valor_unitario: number | null; valor_total: number | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  // uf aceita múltiplos estados (vírgula) — puxa TODOS os estados do Setup (item 11).
  const ufParam = searchParams.get('uf')?.toUpperCase().trim() || undefined
  const ufs = ufParam ? [...new Set(ufParam.split(',').map((s) => s.trim()).filter(Boolean))] : undefined
  const item = searchParams.get('item')?.trim() || undefined
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  const categoriaParam = searchParams.get('categoria')?.trim().toLowerCase() || undefined
  const categoria = categoriaParam && CATEGORIA_KEYS.includes(categoriaParam as never) ? categoriaParam : undefined
  const q = searchParams.get('q')?.trim() || undefined // busca por nome (ILIKE) no ranking
  // Empresa em foco: filtra gráfico/itens/entidades/breakdown por um fornecedor (item 11).
  const chave = searchParams.get('chave')?.trim() || undefined
  const fornecedor = searchParams.get('fornecedor')?.trim() || undefined
  const emFoco = !!(chave || fornecedor)
  // Quantos concorrentes ranquear (3 cards de destaque + o resto na lista expansível).
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 3), 500)

  // WHERE base (uf/ano/item) — usado nas contagens por categoria.
  const whereBase: string[] = ['r.valor_total_homologado IS NOT NULL']
  const baseParams: unknown[] = []
  if (ufs) { baseParams.push(ufs); whereBase.push(`r.uf = ANY($${baseParams.length})`) }
  if (ano) { baseParams.push(ano); whereBase.push(`r.ano = $${baseParams.length}`) }
  if (item) { baseParams.push(`%${item}%`); whereBase.push(`r.nome_catmat ILIKE $${baseParams.length}`) }
  const whereBaseSql = `WHERE ${whereBase.join(' AND ')}`

  // WHERE com a categoria aplicada (escopo geral da tela).
  const where = [...whereBase]
  const params = [...baseParams]
  if (categoria) { params.push(categoria); where.push(`(${CAT_SQL}) = $${params.length}`) }
  const whereSql = `WHERE ${where.join(' AND ')}`

  // WHERE do ranking de concorrentes: escopo + busca por nome (não afeta o foco).
  const rankWhere = [...where]
  const rankParams = [...params]
  if (q) { rankParams.push(`%${q}%`); rankWhere.push(`r.nome_fornecedor ILIKE $${rankParams.length}`) }
  const rankWhereSql = `WHERE ${rankWhere.join(' AND ')}`

  // WHERE "em foco": escopo + a empresa selecionada. Alimenta gráfico/itens/entidades.
  // Sem empresa selecionada, é idêntico ao escopo (comportamento antigo).
  const focusWhere = [...where]
  const focusParams = [...params]
  if (chave) { focusParams.push(chave); focusWhere.push(`${FKEY} = $${focusParams.length}`) }
  else if (fornecedor) { focusParams.push(fornecedor); focusWhere.push(`TRIM(r.nome_fornecedor) = $${focusParams.length}`) }
  const focusWhereSql = `WHERE ${focusWhere.join(' AND ')}`

  try {
    const concParams = [...rankParams, limit]
    const [concorrentes, distribuicaoItens, entidades, ufsComDados, catCounts, breakdown] = await Promise.all([
      query<ConcorrenteRow>(
        `SELECT ${FNOME} AS vencedor,
                ${FKEY} AS chave,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS convenios,
                (array_agg(r.nome_catmat ORDER BY r.valor_total_homologado DESC NULLS LAST))[1] AS item
         FROM resultados r ${rankWhereSql}
         GROUP BY ${FKEY}
         ORDER BY valor DESC NULLS LAST
         LIMIT $${concParams.length}`, concParams),
      query<ItemRow>(
        `SELECT COALESCE(NULLIF(r.nome_catmat, ''), '(sem descrição)') AS item,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(*)::int AS qtd
         FROM resultados r ${focusWhereSql}
         GROUP BY 1
         ORDER BY valor DESC NULLS LAST
         LIMIT 14`, focusParams),
      query<EntidadeRow>(
        `SELECT c.razao_social_orgao AS entidade,
                SUM(r.valor_total_homologado)::float8 AS valor,
                COUNT(DISTINCT r.numero_controle_pncp)::int AS convenios
         FROM resultados r
         LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
         ${focusWhereSql}
         GROUP BY c.razao_social_orgao
         ORDER BY valor DESC NULLS LAST
         LIMIT 30`, focusParams),
      query<UfRow>(`SELECT DISTINCT uf FROM resultados WHERE uf IS NOT NULL ORDER BY uf`),
      query<CatCountRow>(
        `SELECT (${CAT_SQL}) AS categoria, COUNT(*)::int AS n,
                COALESCE(SUM(r.valor_total_homologado), 0)::float8 AS valor
         FROM resultados r ${whereBaseSql} GROUP BY 1`, baseParams),
      // Breakdown por processo (só quando há empresa em foco) — inclui o nº de
      // controle PNCP de cada linha (item 11).
      emFoco
        ? query<BreakdownRow>(
            `SELECT r.numero_controle_pncp AS processo,
                    COALESCE(NULLIF(r.nome_catmat, ''), '(sem descrição)') AS item,
                    c.razao_social_orgao AS entidade,
                    SUM(r.quantidade_homologada)::float8 AS qtd,
                    (SUM(r.valor_total_homologado) / NULLIF(SUM(r.quantidade_homologada), 0))::float8 AS valor_unitario,
                    SUM(r.valor_total_homologado)::float8 AS valor_total
             FROM resultados r
             LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
             ${focusWhereSql}
             GROUP BY r.numero_controle_pncp, item, c.razao_social_orgao
             ORDER BY valor_total DESC NULLS LAST
             LIMIT 300`, focusParams)
        : Promise.resolve([] as BreakdownRow[]),
    ])

    const totalDist = distribuicaoItens.reduce((s, d) => s + (d.valor ?? 0), 0)
    const distribuicao = distribuicaoItens.map((d) => ({
      ...d,
      pct: totalDist > 0 ? Math.round((d.valor / totalDist) * 1000) / 10 : 0,
    }))

    return NextResponse.json({
      uf: ufs ? ufs.join(',') : null,
      categoria: categoria ?? null,
      fornecedor: chave ?? fornecedor ?? null,
      // top3: mantido p/ compatibilidade; concorrentes: ranking completo (até `limit`).
      top3: concorrentes.slice(0, 3),
      concorrentes,
      distribuicaoItens: distribuicao,
      entidades,
      breakdown,
      ufsComDados: ufsComDados.map((u) => u.uf),
      categorias: catCounts,
      valorTotal: entidades.reduce((s, e) => s + (e.valor ?? 0), 0),
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
    console.error('[resultados/concorrentes-estado]', error)
    return NextResponse.json({ error: 'Erro ao consultar concorrentes', detalhe: msg }, { status: 500 })
  }
}
