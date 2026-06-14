// src/app/api/alerts/route.ts — CORRIGIDO
import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, normalizarLicitacao } from '@/lib/pncp'
import { buscarEmendasSaudeAno, parseValorBR } from '@/lib/emendas'
import { Alert } from '@/lib/types'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const revalidate = 600

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const uf = searchParams.get('uf') ?? undefined

  const alerts: Alert[] = []
  const agora = new Date().toISOString()

  // Alertas de editais recentes (PNCP)
  try {
    const hoje = new Date()
    const ontem = new Date(hoje.getTime() - 7 * 86400000)
    const fmt = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '')

    const pncp = await buscarComprasSaude({
      uf,
      dataInicial: fmt(ontem),
      dataFinal: fmt(hoje),
      maxPaginasPorModalidade: 2,
    })

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
      })
    }
  } catch (e) {
    console.warn('[alerts] PNCP:', e)
  }

  // Alertas de emendas de saúde (ano atual)
  try {
    const ano = new Date().getFullYear()
    const emendas = await buscarEmendasSaudeAno(ano, 5)

    for (const emenda of emendas.slice(0, 3)) {
      const valor = parseValorBR(emenda.valorEmpenhado)
      alerts.push({
        id: randomUUID(),
        tipo: 'emenda',
        titulo: 'Emenda parlamentar de saúde',
        descricao: `${emenda.localidadeDoGasto ?? 'Localidade N/D'} — R$${(valor / 1000).toFixed(0)}K empenhados. Autor: ${emenda.autor ?? 'N/D'}.`,
        urgencia: 'media',
        createdAt: agora,
        lida: false,
      })
    }
  } catch (e) {
    console.warn('[alerts] Emendas:', e)
  }

  alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return NextResponse.json({ alerts, total: alerts.length, atualizadoEm: agora })
}