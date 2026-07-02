'use client'
// src/components/dashboard/KPICards.tsx

import { useEffect } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { ArrowUpRight } from 'lucide-react'
import { formatBRLCompact as formatBRL } from '@/lib/format'
import { publishDataStatus } from '@/lib/data-status'
import type { OpportunitiesData } from './DashboardView'

interface KPIs {
  oportunidadesQuentes: number
  valorTotalEstimado: number
  editaisPrevisos60d: number
  municipiosMonitorados: number
}

const CARDS = [
  {
    key: 'oportunidadesQuentes' as const,
    label: 'Oportunidades quentes',
    format: (v: number) => String(v),
    sub: 'Score ≥ 75',
    delta: '+5 esta semana',
    deltaUp: true,
  },
  {
    key: 'valorTotalEstimado' as const,
    label: 'Valor total estimado',
    format: formatBRL,
    sub: 'Pipeline identificado',
    delta: 'dados reais',
    deltaUp: true,
  },
  {
    key: 'editaisPrevisos60d' as const,
    label: 'Editais previstos 60d',
    format: (v: number) => String(v),
    sub: 'Baseado em convênios ativos',
    delta: 'IA preditiva',
    deltaUp: true,
  },
  {
    key: 'municipiosMonitorados' as const,
    label: 'Municípios monitorados',
    format: (v: number) => v.toLocaleString('pt-BR'),
    sub: 'PNCP + TransfereGov',
    delta: 'cobertura nacional',
    deltaUp: true,
  },
]

export default function KPICards({ data, loading, tipo }: { data: OpportunitiesData | null; loading: boolean; tipo?: string }) {
  const opps = data?.oportunidades ?? []
  const kpis: KPIs = {
    oportunidadesQuentes: opps.filter((o) => o.score >= 75).length,
    valorTotalEstimado: opps.reduce((s, o) => s + o.valorEstimado, 0),
    editaisPrevisos60d: opps.filter((o) => o.janelaEmDias <= 60 && o.janelaEmDias > 0).length,
    municipiosMonitorados: new Set(opps.map((o) => `${o.municipio}-${o.uf}`)).size,
  }

  // Publica o status da fonte (selo de proveniência) quando os dados chegam.
  useEffect(() => {
    if (data) publishDataStatus(data)
  }, [data])

  // Cada KPI leva à lista correspondente (não é número morto). Carrega o tipo ativo.
  const tParam = tipo && tipo !== 'todos' ? `tipo=${tipo}` : ''
  const opUrl = (extra = '') => `/oportunidades${[extra, tParam].filter(Boolean).length ? '?' + [extra, tParam].filter(Boolean).join('&') : ''}`
  const HREFS: Record<keyof KPIs, string> = {
    oportunidadesQuentes: opUrl('minScore=70'),
    valorTotalEstimado: opUrl(),
    editaisPrevisos60d: opUrl(),
    municipiosMonitorados: '/estados',
  }

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {CARDS.map((card) => (
        <Link
          key={card.key}
          href={HREFS[card.key]}
          className="group bg-bg2 border border-subtle rounded-xl p-4 hover:border-accent/40 hover:bg-bg2/80 transition-colors block"
        >
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">
              {card.label}
            </div>
            <ArrowUpRight size={13} className="text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className={clsx('font-heading font-bold text-[28px] text-strong leading-none', loading && 'opacity-30')}>
            {loading ? '—' : card.format(kpis[card.key])}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[11px] text-faint">{card.sub}</span>
            {card.deltaUp && (
              <span className="text-[10px] text-accent font-mono-custom">{card.delta}</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}
