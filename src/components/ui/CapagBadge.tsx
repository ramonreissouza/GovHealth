// src/components/ui/CapagBadge.tsx — selo da capacidade de pagamento da instituição.
// Nota A/B/C/D (CAPAG do Tesouro para entes públicos; Serasa para privados). Verde =
// bom pagador (A/B), âmbar/vermelho = risco (C/D), cinza = sem dado (federal/União).

import { clsx } from 'clsx'

export interface CapagInfo {
  fonte: 'capag' | 'serasa' | 'na'
  nota: 'A' | 'B' | 'C' | 'D' | null
  label: string
}

const CLS: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  B: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  C: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  D: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export default function CapagBadge({ cap, className }: { cap?: CapagInfo; className?: string }) {
  if (!cap || cap.fonte === 'na' || !cap.nota) {
    return <span className={clsx('text-[9px] font-mono-custom text-faint', className)} title="Sem classificação de capacidade de pagamento (ente federal ou não avaliado)">—</span>
  }
  const fonteLabel = cap.fonte === 'capag' ? 'CAPAG (Tesouro)' : 'Serasa'
  return (
    <span
      title={`${cap.label} · ${fonteLabel} — capacidade de pagamento da instituição`}
      className={clsx('inline-flex items-center justify-center text-[10px] font-mono-custom font-bold w-6 h-5 rounded-md border', CLS[cap.nota], className)}
    >
      {cap.nota}
    </span>
  )
}
