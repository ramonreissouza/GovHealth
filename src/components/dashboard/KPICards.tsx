'use client'
// src/components/dashboard/KPICards.tsx

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { formatBRLCompact as formatBRL } from '@/lib/format'

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

export default function KPICards() {
  const [kpis, setKpis] = useState<KPIs>({
    oportunidadesQuentes: 0,
    valorTotalEstimado: 0,
    editaisPrevisos60d: 0,
    municipiosMonitorados: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/opportunities?limit=200&minScore=0')
      .then((r) => r.json())
      .then((data) => {
        const opps = data.oportunidades ?? []
        setKpis({
          oportunidadesQuentes: opps.filter((o: any) => o.score >= 75).length,
          valorTotalEstimado: opps.reduce((s: number, o: any) => s + o.valorEstimado, 0),
          editaisPrevisos60d: opps.filter((o: any) => o.janelaEmDias <= 60 && o.janelaEmDias > 0).length,
          municipiosMonitorados: new Set(opps.map((o: any) => `${o.municipio}-${o.uf}`)).size,
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="bg-bg2 border border-subtle rounded-xl p-4"
        >
          <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">
            {card.label}
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
        </div>
      ))}
    </div>
  )
}
