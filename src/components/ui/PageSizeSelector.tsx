'use client'
// src/components/ui/PageSizeSelector.tsx — seletor de "itens por página" para as telas
// com listas grandes (licitações, vencedores, etc.). Padrão 50 = carga inicial rápida;
// o usuário aumenta (200/500) quando quer ver mais de uma vez.

import { clsx } from 'clsx'

export const PAGE_SIZES = [25, 50, 200, 500] as const
export const PAGE_SIZE_PADRAO = 50

export function PageSizeSelector({
  value,
  onChange,
  className,
}: {
  value: number
  onChange: (n: number) => void
  className?: string
}) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      <span className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mr-0.5">Por página</span>
      {PAGE_SIZES.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={clsx(
            'text-[10px] font-mono-custom px-2 py-1 rounded-md transition-all',
            value === n ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3',
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
