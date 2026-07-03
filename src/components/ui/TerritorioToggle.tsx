'use client'
// src/components/ui/TerritorioToggle.tsx — botão "Meu território" reutilizável.
// Liga/desliga o filtro por multi-UF do território (definido no Mapa, item #8).
// Controlado pelo pai (ativo/onToggle); lê a contagem de UFs de territorio.ts.

import { useEffect, useState } from 'react'
import { Target } from 'lucide-react'
import { clsx } from 'clsx'
import { getTerritorio } from '@/lib/territorio'

export default function TerritorioToggle({
  ativo, onToggle, className,
}: { ativo: boolean; onToggle: (novo: boolean) => void; className?: string }) {
  const [n, setN] = useState(0)
  useEffect(() => { setN(getTerritorio().length) }, [])

  const desabilitado = n === 0
  return (
    <button
      onClick={() => !desabilitado && onToggle(!ativo)}
      disabled={desabilitado}
      title={desabilitado ? 'Defina seu território no Mapa (Meu território)' : `Filtrar pelas ${n} UF(s) do seu território`}
      className={clsx(
        'flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border transition-colors flex-shrink-0',
        desabilitado ? 'border-subtle text-faint cursor-not-allowed'
          : ativo ? 'bg-accent/15 text-accent border-accent/40 font-semibold'
          : 'border-subtle2 text-faint hover:text-strong',
        className,
      )}
    >
      <Target size={12} /> Meu território{n ? ` (${n})` : ''}
    </button>
  )
}
