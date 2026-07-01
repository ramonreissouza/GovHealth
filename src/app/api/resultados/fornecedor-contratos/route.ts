// src/app/api/resultados/fornecedor-contratos/route.ts
// Licitações/convênios que UM fornecedor venceu, com detalhes por item
// (instituição, descrição, valores, data). Alimenta o drill-down da tela
// Concorrentes. Lê resultados homologados do banco (ETL) — não chama o PNCP ao vivo.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { CATEGORIA_KEYS, categoriaCaseSql } from '@/lib/categoria-mercado'

export const runtime = 'nodejs'

const CAT_SQL = categoriaCaseSql('r.nome_catmat')

interface Row {
  convenio: string
  proponente: string | null
  municipio: string | null
  uf: string | null
  modalidade_nome: string | null
  objeto_compra: string | null
  cnpj_orgao: string | null
  ano_compra: number | null
  sequencial_compra: number | null
  data_publicacao: string | null
  numero_item: number | null
  nome_catmat: string | null
  codigo_catmat: string | null
  categoria: string | null
  qtd: number | null
  valor_unitario: number | null
  valor: number | null
  data_resultado: string | null
}

function pncpUrl(cnpj: string | null, ano: number | null, seq: number | null): string | null {
  if (!cnpj || !ano || seq == null) return null
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const fornecedor = searchParams.get('fornecedor')?.trim()
  const ufParam = searchParams.get('uf')?.toUpperCase().trim() || undefined
  const ufs = ufParam ? ufParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  const ano = searchParams.get('ano') ? Number(searchParams.get('ano')) : undefined
  const categoriaParam = searchParams.get('categoria')?.trim().toLowerCase() || undefined
  const categoria = categoriaParam && CATEGORIA_KEYS.includes(categoriaParam as never) ? categoriaParam : undefined

  if (!fornecedor) {
    return NextResponse.json({ error: 'Parâmetro "fornecedor" obrigatório.' }, { status: 400 })
  }

  const where: string[] = ['r.valor_total_homologado IS NOT NULL', 'r.nome_fornecedor = $1']
  const params: unknown[] = [fornecedor]
  if (ufs) { params.push(ufs); where.push(`r.uf = ANY($${params.length})`) }
  if (ano) { params.push(ano); where.push(`r.ano = $${params.length}`) }
  if (categoria) { params.push(categoria); where.push(`(${CAT_SQL}) = $${params.length}`) }

  try {
    const rows = await query<Row>(
      `SELECT r.numero_controle_pncp AS convenio,
              c.razao_social_orgao AS proponente,
              c.municipio, c.uf, c.modalidade_nome, c.objeto_compra,
              c.cnpj_orgao, c.ano_compra, c.sequencial_compra, c.data_publicacao,
              r.numero_item, r.nome_catmat, r.codigo_catmat,
              (${CAT_SQL}) AS categoria,
              r.quantidade_homologada::float8     AS qtd,
              r.valor_unitario_homologado::float8 AS valor_unitario,
              r.valor_total_homologado::float8    AS valor,
              r.data_resultado
       FROM resultados r
       LEFT JOIN contratacoes c ON c.numero_controle_pncp = r.numero_controle_pncp
       WHERE ${where.join(' AND ')}
       ORDER BY r.valor_total_homologado DESC NULLS LAST
       LIMIT 3000`,
      params,
    )

    // Agrupa por convênio (licitação).
    const mapa = new Map<string, {
      convenio: string
      proponente: string | null
      municipio: string | null
      uf: string | null
      modalidade_nome: string | null
      objeto_compra: string | null
      data: string | null
      pncp_url: string | null
      valorTotal: number
      itens: { numero_item: number | null; nome_catmat: string | null; codigo_catmat: string | null; categoria: string | null; qtd: number | null; valor_unitario: number | null; valor: number | null }[]
    }>()

    for (const r of rows) {
      let g = mapa.get(r.convenio)
      if (!g) {
        g = {
          convenio: r.convenio,
          proponente: r.proponente,
          municipio: r.municipio,
          uf: r.uf,
          modalidade_nome: r.modalidade_nome,
          objeto_compra: r.objeto_compra,
          data: r.data_resultado ?? r.data_publicacao ?? null,
          pncp_url: pncpUrl(r.cnpj_orgao, r.ano_compra, r.sequencial_compra),
          valorTotal: 0,
          itens: [],
        }
        mapa.set(r.convenio, g)
      }
      // data mais recente disponível para o grupo
      const d = r.data_resultado ?? r.data_publicacao ?? null
      if (d && (!g.data || d > g.data)) g.data = d
      g.valorTotal += r.valor ?? 0
      g.itens.push({
        numero_item: r.numero_item,
        nome_catmat: r.nome_catmat,
        codigo_catmat: r.codigo_catmat,
        categoria: r.categoria,
        qtd: r.qtd,
        valor_unitario: r.valor_unitario,
        valor: r.valor,
      })
    }

    const contratos = [...mapa.values()].sort((a, b) => b.valorTotal - a.valorTotal)
    const valorTotal = contratos.reduce((s, c) => s + c.valorTotal, 0)
    const nItens = rows.length
    const ufsAtuacao = [...new Set(rows.map((r) => r.uf).filter(Boolean))] as string[]

    return NextResponse.json({
      fornecedor,
      resumo: {
        valorTotal,
        convenios: contratos.length,
        itens: nItens,
        ufs: ufsAtuacao.length,
        ufsAtuacao,
      },
      contratos,
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
    console.error('[resultados/fornecedor-contratos]', error)
    return NextResponse.json({ error: 'Erro ao consultar contratos do fornecedor', detalhe: msg }, { status: 500 })
  }
}
