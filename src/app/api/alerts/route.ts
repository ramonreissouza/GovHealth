// src/app/api/alerts/route.ts — CORRIGIDO
import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, normalizarLicitacao } from '@/lib/pncp'
import { buscarEmendasSaudeAno, parseValorBR, type EmendaParlamentar } from '@/lib/emendas'
import { query } from '@/lib/db'
import { isTipoFornecimento } from '@/lib/tipo-sql'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { Alert } from '@/lib/types'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const revalidate = 600
export const maxDuration = 30 // fallback de emendas pode varrer múltiplos anos

interface EditalRow {
  numero_controle_pncp: string
  razao_social_orgao: string | null
  municipio: string | null
  uf: string | null
  objeto_compra: string | null
  valor_total_estimado: number | null
  data_publicacao: string | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf') ?? undefined
  const tipoParam = searchParams.get('tipo') ?? undefined
  const tipo = tipoParam && tipoParam !== 'todos' && isTipoFornecimento(tipoParam) ? tipoParam : undefined

  const cacheKey = `alerts:${uf ?? ''}:${tipo ?? ''}`
  const cachedAlerts = getCached<object>(cacheKey)
  if (cachedAlerts) return NextResponse.json(cachedAlerts)

  const alerts: Alert[] = []
  const agora = new Date().toISOString()

  // Alertas de editais recentes — banco (ETL) primeiro; PNCP ao vivo como fallback.
  try {
    const where: string[] = ['valor_total_estimado >= 10000', 'objeto_compra IS NOT NULL']
    const args: unknown[] = []
    if (uf) { args.push(uf.toUpperCase()); where.push(`uf = $${args.length}`) }
    if (tipo) { args.push(tipo); where.push(`tipo_fornecimento = $${args.length}`) }
    const editais = await query<EditalRow>(
      `SELECT numero_controle_pncp, razao_social_orgao, municipio, uf, objeto_compra,
              valor_total_estimado::float8 AS valor_total_estimado,
              to_char(data_publicacao, 'YYYY-MM-DD') AS data_publicacao
       FROM contratacoes
       WHERE ${where.join(' AND ')}
       ORDER BY data_publicacao DESC NULLS LAST, valor_total_estimado DESC
       LIMIT 6`,
      args,
    )

    if (editais.length) {
      for (const e of editais) {
        const valor = e.valor_total_estimado ?? 0
        const local = [e.municipio, e.uf].filter(Boolean).join('/') || 'Local N/D'
        alerts.push({
          id: `edital-${e.numero_controle_pncp}`,
          tipo: 'edital',
          titulo: 'Edital de saúde publicado',
          descricao: `${e.razao_social_orgao ?? 'Órgão N/D'} (${local}): ${(e.objeto_compra ?? '').substring(0, 90)}… — R$${(valor / 1000).toFixed(0)}K`,
          urgencia: 'alta',
          createdAt: e.data_publicacao ? `${e.data_publicacao}T00:00:00.000Z` : agora,
          lida: false,
          href: `/oportunidades?opp=${encodeURIComponent(`pncp-${e.numero_controle_pncp}`)}`,
        })
      }
    } else {
      // Fallback: PNCP ao vivo (banco vazio).
      const hoje = new Date()
      const ontem = new Date(hoje.getTime() - 7 * 86400000)
      const fmt = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '')
      const pncp = await buscarComprasSaude({ uf, dataInicial: fmt(ontem), dataFinal: fmt(hoje), maxPaginasPorModalidade: 2 })
      for (const raw of pncp.data.slice(0, 5)) {
        const lic = normalizarLicitacao(raw)
        alerts.push({
          id: randomUUID(),
          tipo: 'edital',
          titulo: 'Novo edital de saúde publicado',
          descricao: `${lic.orgaoEntidade.razaoSocial}: ${lic.objetoCompra.substring(0, 80)}... Valor: R$${((lic.valorTotalEstimado ?? 0) / 1000).toFixed(0)}K`,
          urgencia: 'alta',
          createdAt: lic.dataPublicacaoPncp ?? agora,
          lida: false,
          href: '/oportunidades',
        })
      }
    }
  } catch (e) {
    console.warn('[alerts] editais:', e)
  }

  // Alertas de emendas de saúde — sinal orçamentário sem tipo de fornecimento,
  // então só aparecem quando não há filtro de tipo específico ('todos').
  // Tenta o ano atual e recua para anos anteriores (emendas do ano corrente são esparsas).
  if (!tipo) try {
    const anoAtual = new Date().getFullYear()
    let emendas: EmendaParlamentar[] = []
    let anoEmendas = anoAtual
    for (const ano of [anoAtual, anoAtual - 1, anoAtual - 2]) {
      emendas = await buscarEmendasSaudeAno(ano, 6)
      if (emendas.length > 0) { anoEmendas = ano; break }
    }

    // Maiores valores empenhados primeiro
    emendas.sort((a, b) => parseValorBR(b.valorEmpenhado) - parseValorBR(a.valorEmpenhado))

    for (const emenda of emendas.slice(0, 3)) {
      const valor = parseValorBR(emenda.valorEmpenhado)
      alerts.push({
        id: randomUUID(),
        tipo: 'emenda',
        titulo: `Emenda parlamentar de saúde (${anoEmendas})`,
        descricao: `${emenda.localidadeDoGasto ?? 'Localidade N/D'} — R$${(valor / 1000).toFixed(0)}K empenhados. Autor: ${emenda.autor ?? 'N/D'}.`,
        urgencia: 'media',
        createdAt: agora,
        lida: false,
        href: '/radar-verba',
      })
    }
  } catch (e) {
    console.warn('[alerts] Emendas:', e)
  }

  alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const payload = { alerts, total: alerts.length, atualizadoEm: agora }
  setCached(cacheKey, payload, TTL.SHORT)
  return NextResponse.json(payload)
}