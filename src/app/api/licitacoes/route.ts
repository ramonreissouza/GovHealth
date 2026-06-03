// src/app/api/licitacoes/route.ts
// Retorna licitações estruturadas do PNCP com categorização e KPIs
// Usado pelas páginas Analise (/analise) e Concorrentes (/concorrentes)

import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, normalizarLicitacao } from '@/lib/pncp'
import { inferirCategoria } from '@/lib/score-engine'
import { getCached, setCached, TTL } from '@/lib/server-cache'

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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf') ?? undefined
  const limit = Number(searchParams.get('limit') ?? 500)

  const cacheKey = `licitacoes:${uf ?? ''}:${limit}`
  const cached = getCached<object>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    const pncpResult = await buscarComprasSaude({ uf, tamanhoPagina: 100 })

    const licitacoes: LicitacaoEnriquecida[] = pncpResult.data.map((raw) => {
      const norm = normalizarLicitacao(raw)
      const valorHomologado = raw.valorTotalHomologado ?? 0
      const valorEstimado = raw.valorTotalEstimado ?? 0
      return {
        id: norm.id,
        numeroControlePNCP: norm.numeroControlePNCP,
        proponente: norm.orgaoEntidade.razaoSocial,
        cnpj: norm.orgaoEntidade.cnpj,
        municipio: norm.orgaoEntidade.municipio ?? '',
        uf: norm.orgaoEntidade.uf ?? '',
        modalidade: norm.modalidadeNome,
        categoria: inferirCategoria(raw.objetoCompra),
        descricao: raw.objetoCompra.substring(0, 120),
        valor: valorHomologado || valorEstimado,
        valorEstimado,
        valorHomologado,
        situacaoId: raw.situacaoCompraId,
        situacao: raw.situacaoCompraNome,
        ano: raw.dataPublicacaoPncp?.substring(0, 4) ?? '—',
        dataPublicacao: raw.dataPublicacaoPncp ?? '',
        dataEncerramento: raw.dataEncerramentoProposta,
        link: raw.linkSistemaOrigem ?? '',
        anoCompra: raw.anoCompra,
        sequencialCompra: raw.sequencialCompra,
      }
    })

    // ── KPIs ────────────────────────────────────────────────────────────────
    const valorTotal = licitacoes.reduce((s, l) => s + l.valor, 0)
    const ticketMedio = licitacoes.length ? Math.round(valorTotal / licitacoes.length) : 0

    // ── Por categoria ────────────────────────────────────────────────────────
    const porCategoria: Record<string, { count: number; valor: number }> = {}
    for (const l of licitacoes) {
      if (!porCategoria[l.categoria]) porCategoria[l.categoria] = { count: 0, valor: 0 }
      porCategoria[l.categoria].count++
      porCategoria[l.categoria].valor += l.valor
    }

    // ── Por UF ───────────────────────────────────────────────────────────────
    const porUF: Record<string, number> = {}
    for (const l of licitacoes) {
      if (l.uf) porUF[l.uf] = (porUF[l.uf] ?? 0) + l.valor
    }

    // ── Top proponentes ───────────────────────────────────────────────────────
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
      licitacoes: licitacoes.slice(0, limit),
      kpis: { total: licitacoes.length, valorTotal, ticketMedio },
      porCategoria,
      porUF,
      topProponentes,
      atualizadoEm: new Date().toISOString(),
    }
    setCached(cacheKey, payload, TTL.SHORT)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[licitacoes]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
