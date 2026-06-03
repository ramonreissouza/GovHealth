'use client'
// src/components/ui/ScoreBadge.tsx

import { clsx } from 'clsx'
import React from 'react'

// ── Existing lightweight exports (used by other components) ──────────────────

export function Tag({ children, variant = 'blue' }: { children: React.ReactNode; variant?: 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono-custom', `tag-${variant}`)}>
      {children}
    </span>
  )
}

export function urgenciaToVariant(urgencia: string): 'red' | 'amber' | 'blue' | 'green' {
  if (urgencia === 'urgente') return 'red'
  if (urgencia === 'alta') return 'amber'
  if (urgencia === 'media') return 'blue'
  return 'green'
}

// ── ScoreBadge with tooltip ──────────────────────────────────────────────────

const SCORE_CLASS: Record<string, string> = {
  quente: 'score-hot',
  morno: 'score-warm',
  frio: 'score-cold',
}

const STATUS_COLOR: Record<string, string> = {
  quente: 'text-orange-400',
  morno: 'text-amber-400',
  frio: 'text-brand-blue',
}

const STATUS_LABEL: Record<string, string> = {
  quente: 'Quente',
  morno: 'Morno',
  frio: 'Frio',
}

const SUBSCORE_LABEL: Record<string, string> = {
  convenio: 'Convênio',
  historico: 'Histórico',
  orgao: 'Órgão',
  competicao: 'Competição',
}

interface ScoreBadgeProps {
  score: number
  status?: 'quente' | 'morno' | 'frio'
  subScores?: Record<string, number>
  acaoRecomendada?: string
  size?: 'sm' | 'md'
  side?: 'right' | 'left'
}

export function ScoreBadge({ score, status, subScores, acaoRecomendada, size = 'md', side = 'right' }: ScoreBadgeProps) {
  const resolvedStatus = status ?? (score >= 75 ? 'quente' : score >= 50 ? 'morno' : 'frio')

  // When tooltip props are not provided, render simple badge (backward compatible)
  if (!acaoRecomendada) {
    return (
      <span className={clsx(
        'inline-flex items-center justify-center rounded-lg font-mono-custom font-medium flex-shrink-0',
        size === 'md' ? 'w-9 h-9 text-[13px]' : 'w-7 h-7 text-[11px]',
        SCORE_CLASS[resolvedStatus],
      )}>
        {score}
      </span>
    )
  }

  return (
    <div className="group relative flex-shrink-0">
      {/* Badge */}
      <span className={clsx(
        'inline-flex items-center justify-center rounded-lg font-mono-custom font-bold cursor-help select-none',
        size === 'md' ? 'w-10 h-10 text-[13px]' : 'w-9 h-9 text-[12px]',
        SCORE_CLASS[resolvedStatus],
      )}>
        {score}
      </span>

      {/* Tooltip — floats left or right of badge */}
      <div className={clsx(
        side === 'left'
          ? 'absolute right-12 top-1/2 -translate-y-1/2 w-64'
          : 'absolute left-12 top-1/2 -translate-y-1/2 w-64',
        'bg-bg2 border border-subtle2 rounded-xl shadow-2xl p-3.5',
        'opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-[200]',
      )}>
        {side === 'left' ? (
          <>
            <div className="absolute left-full top-1/2 -translate-y-1/2 w-0 h-0
              border-t-[6px] border-b-[6px] border-l-[6px]
              border-t-transparent border-b-transparent border-l-subtle2" />
            <div className="absolute left-full top-1/2 -translate-y-1/2 -translate-x-px w-0 h-0
              border-t-[5px] border-b-[5px] border-l-[5px]
              border-t-transparent border-b-transparent border-l-bg2" />
          </>
        ) : (
          <>
            <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0
              border-t-[6px] border-b-[6px] border-r-[6px]
              border-t-transparent border-b-transparent border-r-subtle2" />
            <div className="absolute right-full top-1/2 -translate-y-1/2 translate-x-px w-0 h-0
              border-t-[5px] border-b-[5px] border-r-[5px]
              border-t-transparent border-b-transparent border-r-bg2" />
          </>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-mono-custom text-faint uppercase tracking-widest">Opportunity Score</span>
          <span className={clsx('text-[10px] font-mono-custom font-semibold', STATUS_COLOR[resolvedStatus])}>
            {STATUS_LABEL[resolvedStatus]}
          </span>
        </div>

        {/* Big number */}
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-[30px] font-mono-custom font-bold text-strong leading-none">{score}</span>
          <span className="text-[11px] text-faint">/100</span>
        </div>

        {/* Driving reason */}
        <p className="text-[10px] text-muted leading-relaxed mb-3">{acaoRecomendada}</p>

        {/* Sub-scores */}
        {subScores && Object.keys(subScores).length > 0 && (
          <div className="border-t border-subtle pt-2.5 space-y-1.5">
            <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Composição</div>
            {Object.entries(subScores).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[9px] text-faint font-mono-custom w-16 truncate">
                  {SUBSCORE_LABEL[key] ?? key}
                </span>
                <div className="flex-1 h-1 bg-bg4 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${val}%` }} />
                </div>
                <span className="text-[9px] font-mono-custom text-strong w-5 text-right">{val}</span>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="border-t border-subtle pt-2 mt-2.5 flex gap-2 text-[8px] font-mono-custom flex-wrap">
          <span className="text-orange-400">≥75 Quente</span>
          <span className="text-faint">·</span>
          <span className="text-amber-400">≥50 Morno</span>
          <span className="text-faint">·</span>
          <span className="text-brand-blue">&lt;50 Frio</span>
        </div>
      </div>
    </div>
  )
}

export default ScoreBadge
