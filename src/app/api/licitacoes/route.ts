// src/app/api/licitacoes/route.ts
// Licitações de saúde a partir do BANCO (contratacoes + resultados populados pelo
// ETL) — NÃO chama o PNCP ao vivo. Usado pela tela "Maior Atuação" (/analise).
// Status aberto/encerrada = ausência/presença de resultado homologado.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { inferirCategoria, classificarTipo } from '@/lib/score-engine'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import type { TipoFornecimento } from '@/lib/types'

export const runtime = 'nodejs'
export const revalidate = 1800

export interface LicitacaoEnriquecida {
  id: string
  numeroControlePNCP: string
  proponente: string
  cnpj: string
  municipio: string
  uf: string
  modalidade: string
  categoria: string
  tipo: TipoFornecimento
  descricao: string
  valor: number
  valorEstimado: number
  valorHomologado: number
  situacaoId: number
  situacao: string
  ano: string
  dataPublicacao: string
  dataEncerramento?: string
  link: string
  anoCompra: number
  sequencialCompra: number
}

interface Row {
  numero_controle_pncp: string
  cnpj_orgao: string
  razao_social_orgao: string | null
  municipio: string | null
  uf: string | null
  modalidade_nome: string | null
  objeto_compra: string | null
  ano_compra: number | null
  sequencial_compra: number | null
  valor_estimado: number | null
  valor_homologado: number | null
  encerrada: boolean
  data_publicacao: string | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf')?.toUpperCase().trim() || undefined
  const limit = Math.min(Number(searchParams.get('limit') ?? 500), 2000)

  const cacheKey = `licitacoes:db:${uf ?? ''}:${limit}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  // Filtro opcional por UF ("CE" ou "CE,BA").
  const params: unknown[] = []
  let whereSql = ''
  if (uf) { params.push(uf.split(',')); whereSql = `WHERE c.uf = ANY($${params.length})` }

  try {
    const rows = await query<Row>(
      `SELECT c.numero_controle_pncp, c.cnpj_orgao, c.razao_social_orgao, c.municipio, c.uf,
              c.modalidade_nome, c.objeto_compra, c.ano_compra, c.sequencial_compra,
              c.valor_total_estimado::float8      AS valor_estimado,
              r.valor_homologado::float8          AS valor_homologado,
              (r.valor_homologado IS NOT NULL)    AS encerrada,
              to_char(c.data_publicacao, 'YYYY-MM-DD') AS data_publicacao
       FROM contratacoes c
       LEFT JOIN (
         SELECT numero_controle_pncp, SUM(valor_total_homologado) AS valor_homologado
         FROM resultados GROUP BY numero_controle_pncp
       ) r ON r.numero_controle_pncp = c.numero_controle_pncp
       ${whereSql}
       ORDER BY COALESCE(r.valor_homologado, c.valor_total_estimado, 0) DESC NULLS LAST
       LIMIT $${params.length + 1}`,
      [...params, limit],
    )

    const licitacoes: LicitacaoEnriquecida[] = rows.map((c) => {
      const valorHomologado = c.valor_homologado ?? 0
      const valorEstimado = c.valor_estimado ?? 0
      const ano = c.ano_compra ? String(c.ano_compra) : (c.data_publicacao?.substring(0, 4) ?? '—')
      return {
        id: c.numero_controle_pncp,
        numeroControlePNCP: c.numero_controle_pncp,
        proponente: c.razao_social_orgao ?? '—',
        cnpj: c.cnpj_orgao,
        municipio: c.municipio ?? '',
        uf: c.uf ?? '',
        modalidade: c.modalidade_nome ?? '',
        categoria: inferirCategoria(c.objeto_compra ?? ''),
        tipo: classificarTipo(c.objeto_compra ?? ''),
        descricao: (c.objeto_compra ?? '').substring(0, 120),
        valor: valorHomologado || valorEstimado,
        valorEstimado,
        valorHomologado,
        // Status derivado do banco: com resultado homologado = Encerrada; sem = Em Aberto.
        situacaoId: c.encerrada ? 4 : 1,
        situacao: c.encerrada ? 'Encerrada' : 'Em Aberto',
        ano,
        dataPublicacao: c.data_publicacao ?? '',
        // PNCP não guarda linkSistemaOrigem no banco; monta a URL canônica do edital.
        link: c.cnpj_orgao && c.ano_compra && c.sequencial_compra
          ? `https://pncp.gov.br/app/editais/${c.cnpj_orgao}/${c.ano_compra}/${c.sequencial_compra}`
          : '',
        anoCompra: c.ano_compra ?? 0,
        sequencialCompra: c.sequencial_compra ?? 0,
      }
    })

    // ── Agregações (mantidas para compatibilidade da resposta) ─────────────────
    const valorTotal = licitacoes.reduce((s, l) => s + l.valor, 0)
    const ticketMedio = licitacoes.length ? Math.round(valorTotal / licitacoes.length) : 0

    const porCategoria: Record<string, { count: number; valor: number }> = {}
    for (const l of licitacoes) {
      if (!porCategoria[l.categoria]) porCategoria[l.categoria] = { count: 0, valor: 0 }
      porCategoria[l.categoria].count++
      porCategoria[l.categoria].valor += l.valor
    }

    const porUF: Record<string, number> = {}
    for (const l of licitacoes) if (l.uf) porUF[l.uf] = (porUF[l.uf] ?? 0) + l.valor

    const pmap: Record<string, { proponente: string; uf: string; municipio: string; valor: number; count: number }> = {}
    for (const l of licitacoes) {
      if (!pmap[l.cnpj]) pmap[l.cnpj] = { proponente: l.proponente, uf: l.uf, municipio: l.municipio, valor: 0, count: 0 }
      pmap[l.cnpj].valor += l.valor
      pmap[l.cnpj].count++
    }
    const topProponentes = Object.entries(pmap)
      .sort((a, b) => b[1].valor - a[1].valor)
      .slice(0, 30)
      .map(([cnpj, d]) => ({ cnpj, ...d }))

    const payload = {
      licitacoes,
      kpis: { total: licitacoes.length, valorTotal, ticketMedio },
      porCategoria,
      porUF,
      topProponentes,
      atualizadoEm: new Date().toISOString(),
      fonte: 'PNCP · banco (ETL)',
    }
    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
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
    console.error('[licitacoes]', error)
    return NextResponse.json({ error: 'Erro ao consultar licitações', detalhe: msg }, { status: 500 })
  }
}
