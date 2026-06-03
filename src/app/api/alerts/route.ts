// src/app/api/alerts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude } from '@/lib/pncp'
import { buscarEmendasSaude } from '@/lib/transferegov'
import { buscarAvisosLicitacaoSaude } from '@/lib/dou'
import { Alert } from '@/lib/types'
import { randomUUID } from 'crypto'
import { MOCK_OPORTUNIDADES } from '@/lib/mock-data'

export const runtime = 'nodejs'
export const revalidate = 600 // 10 min

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf') ?? undefined

  const alerts: Alert[] = []
  const agora = new Date().toISOString()

  // Alertas de editais recentes (últimas 48h do período com dados disponíveis)
  try {
    const PNCP_CUTOFF = new Date('2025-12-31')
    const base = new Date() > PNCP_CUTOFF ? PNCP_CUTOFF : new Date()
    const ontem = new Date(base)
    ontem.setDate(ontem.getDate() - 2)
    const dataInicial = ontem.toISOString().split('T')[0]

    const licitacoes = await buscarComprasSaude({ uf, dataInicial, tamanhoPagina: 20 })

    for (const lic of licitacoes.data.slice(0, 5)) {
      alerts.push({
        id: randomUUID(),
        tipo: 'edital',
        titulo: 'Novo edital publicado',
        descricao: `${lic.orgaoEntidade.razaoSocial}: ${lic.objetoCompra.substring(0, 80)}... Valor: R$${((lic.valorTotalEstimado ?? 0) / 1000).toFixed(0)}K`,
        urgencia: 'alta',
        createdAt: lic.dataPublicacaoPncp ?? agora,
        lida: false,
      })
    }
  } catch (e) {
    console.warn('[alerts] PNCP error:', e)
  }

  // Alertas de emendas parlamentares recentes
  try {
    const emendas = await buscarEmendasSaude({ uf })
    if (Array.isArray(emendas) && emendas.length > 0) {
      for (const emenda of emendas.slice(0, 3)) {
        alerts.push({
          id: randomUUID(),
          tipo: 'emenda',
          titulo: 'Emenda parlamentar de saúde aprovada',
          descricao: `${emenda.municipio ?? 'Município N/D'} — R$${(Number(emenda.valor ?? 0) / 1000).toFixed(0)}K aprovados. Oportunidade de licitação em ~87 dias.`,
          urgencia: 'media',
          createdAt: agora,
          lida: false,
        })
      }
    }
  } catch (e) {
    console.warn('[alerts] Emendas error:', e)
  }

  // Alertas do DOU — avisos de licitação publicados na Seção 3
  try {
    const avisosDOU = await buscarAvisosLicitacaoSaude(2)
    for (const aviso of avisosDOU.slice(0, 4)) {
      alerts.push({
        id: randomUUID(),
        tipo: 'edital',
        titulo: 'Aviso DOU — pré-edital de saúde',
        descricao: `${aviso.orgao ?? 'Órgão N/D'}: ${(aviso.titulo || aviso.resumo).substring(0, 100)}${aviso.valorEstimado ? ` — R$${(aviso.valorEstimado / 1000).toFixed(0)}K` : ''}`,
        urgencia: 'alta',
        createdAt: aviso.data ? new Date(aviso.data).toISOString() : agora,
        lida: false,
      })
    }
  } catch (e) {
    console.warn('[alerts] DOU error:', e)
  }

  // Fallback: se nenhuma fonte retornou alertas, gera a partir do dataset local
  if (alerts.length === 0) {
    const urgentes = MOCK_OPORTUNIDADES.filter((o) => o.urgencia === 'urgente' || o.urgencia === 'alta')
    for (const o of urgentes.slice(0, 5)) {
      alerts.push({
        id: randomUUID(),
        tipo: 'edital',
        titulo: o.urgencia === 'urgente' ? 'Edital encerrando — ação imediata' : 'Novo edital publicado',
        descricao: `${o.hospital}: ${o.descricao.substring(0, 80)}... Valor: R$${(o.valorEstimado / 1000).toFixed(0)}K`,
        urgencia: o.urgencia === 'urgente' ? 'alta' : 'media',
        createdAt: o.createdAt,
        lida: false,
      })
    }
  }

  // Ordenar por data desc
  alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return NextResponse.json({
    alerts,
    total: alerts.length,
    atualizadoEm: agora,
  })
}
