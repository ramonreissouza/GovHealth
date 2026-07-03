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

// ── ScoreBadge com painel de composição (clique → expande) ───────────────────

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
  /** @deprecated o painel agora abre para baixo ao clicar; mantido por compat. */
  side?: 'right' | 'left'
}

export function ScoreBadge({ score, status, subScores, acaoRecomendada, size = 'md' }: ScoreBadgeProps) {
  const resolvedStatus = status ?? (score >= 75 ? 'quente' : score >= 50 ? 'morno' : 'frio')

  const [open, setOpen] = React.useState(false)
  const [alinhaDireita, setAlinhaDireita] = React.useState(false)
  const [abreCima, setAbreCima] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc.
  React.useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Badge simples quando não há detalhes (compatível com usos antigos).
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

  function alternar(e: React.MouseEvent) {
    e.stopPropagation() // não dispara clique do card/linha ao redor
    const el = wrapperRef.current
    if (el && typeof window !== 'undefined') {
      const rect = el.getBoundingClientRect()
      // Alinhamento: se falta espaço à direita, alinha o painel pela direita.
      setAlinhaDireita(window.innerWidth - rect.left < 280)
      // Abre para cima só se não houver espaço para baixo (padrão: para baixo).
      setAbreCima(window.innerHeight - rect.bottom < 300)
    }
    setOpen((o) => !o)
  }

  return (
    <div ref={wrapperRef} className="relative flex-shrink-0">
      {/* Badge — clique abre/fecha o painel de composição do score */}
      <button
        type="button"
        onClick={alternar}
        title="Ver composição do score"
        className={clsx(
          'inline-flex items-center justify-center rounded-lg font-mono-custom font-bold cursor-pointer select-none',
          size === 'md' ? 'w-10 h-10 text-[13px]' : 'w-9 h-9 text-[12px]',
          SCORE_CLASS[resolvedStatus],
          open && 'ring-2 ring-accent',
        )}
      >
        {score}
      </button>

      {/* Painel — abre PARA BAIXO ao clicar (flip p/ cima/lado só se faltar espaço) */}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={clsx(
            'absolute w-64 z-[200] bg-bg2 border border-subtle2 rounded-xl shadow-2xl p-3.5',
            abreCima ? 'bottom-full mb-2' : 'top-full mt-2',
            alinhaDireita ? 'right-0' : 'left-0',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-mono-custom text-faint uppercase tracking-widest">Composição do score</span>
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
              <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Fatores</div>
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
      )}
    </div>
  )
}

export default ScoreBadge
