// src/components/ui/PagometroBadge.tsx — selo do Pagômetro, ao lado do CAPAG: em quantos
// dias o ente paga depois de reconhecer a nota. A frase completa (com a ressalva do que
// não é medido) vai no title e no aria-label; o selo mostra só os dias.
// Sem dado, não renderiza nada: um "—" aqui pareceria "paga mal".

import { clsx } from 'clsx'
import { Timer } from 'lucide-react'
import { diasSelo, textoPagometro, type PagometroInfo } from '@/lib/pagometro-texto'

const CLS: Record<PagometroInfo['faixa'], string> = {
  rapido: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  medio: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  lento: 'bg-red-500/10 text-red-400 border-red-500/25',
}

export default function PagometroBadge({ p, className }: { p?: PagometroInfo | null; className?: string }) {
  if (!p) return null
  const texto = textoPagometro(p)
  return (
    <span
      title={texto}
      aria-label={`Pagômetro: ${texto}`}
      className={clsx('inline-flex items-center gap-0.5 text-[9px] font-mono-custom px-1.5 h-4 rounded-md border whitespace-nowrap', CLS[p.faixa], className)}
    >
      <Timer size={9} aria-hidden="true" />
      {diasSelo(p.dias)}
    </span>
  )
}
