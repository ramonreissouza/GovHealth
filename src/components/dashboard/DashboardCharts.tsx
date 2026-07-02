'use client'
// src/components/dashboard/DashboardCharts.tsx

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

import { CATEGORIA_CHART_COLOR as CAT_COLORS, CATEGORIA_LABEL as CAT_LABELS } from '@/lib/categorias'
import type { OpportunitiesData } from './DashboardView'

export default function DashboardCharts({ data, loading }: { data: OpportunitiesData | null; loading: boolean }) {
  // Agregados calculados no servidor sobre o dataset COMPLETO do banco (série de 12
  // meses e distribuição por categoria) — recebidos por props do DashboardView.
  const serie = data?.serieMensal ?? []
  const porCat = data?.porCategoria ?? []

  // Série mensal — últimos 12 meses (preenche buracos de meses sem dado).
  const serieMap = new Map(serie.map((s) => [s.mes, s]))
  const monthlyData = (() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - idx), 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
      const hit = serieMap.get(key)
      return {
        mes: label,
        count: hit?.count ?? 0,
        valor: (hit?.valor ?? 0) / 1_000_000,
      }
    })
  })()

  // Distribuição por categoria (dataset completo).
  const catData = porCat
    .map((c) => ({ cat: CAT_LABELS[c.categoria] ?? c.categoria, count: c.count, key: c.categoria }))
    .sort((a, b) => b.count - a.count)

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-bg2 border border-subtle rounded-xl p-4 h-[220px] animate-pulse" />
        <div className="bg-bg2 border border-subtle rounded-xl p-4 h-[220px] animate-pulse" />
      </div>
    )
  }

  const tooltipStyle = {
    background: '#1a1a2e', border: '1px solid #2a2a4a',
    borderRadius: 8, fontSize: 11,
  }

  return (
    <div className="grid grid-cols-2 gap-3 mb-3">
      {/* Area chart: tendência mensal */}
      <div className="bg-bg2 border border-subtle rounded-xl p-4">
        <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">
          Licitações publicadas — últimos 12 meses
        </div>
        <ResponsiveContainer width="100%" height={170}>
          <AreaChart data={monthlyData} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="mes" tick={{ fontSize: 9, fill: '#666' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#666' }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: '#aaa' }}
              formatter={(v) => [v, 'Licitações']}
            />
            <Area
              type="monotone" dataKey="count"
              stroke="var(--accent)" fill="url(#areaGrad)"
              strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Bar chart: categorias */}
      <div className="bg-bg2 border border-subtle rounded-xl p-4">
        <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">
          Distribuição por categoria
        </div>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={catData} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 9, fill: '#666' }} tickLine={false} axisLine={false} />
            <YAxis
              dataKey="cat" type="category"
              tick={{ fontSize: 9, fill: '#aaa' }}
              tickLine={false} axisLine={false} width={76}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => [v, 'Licitações']}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={14}>
              {catData.map((d, i) => (
                <Cell key={i} fill={CAT_COLORS[d.key] ?? '#94a3b8'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
