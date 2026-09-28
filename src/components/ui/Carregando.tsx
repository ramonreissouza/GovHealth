'use client'
// src/components/ui/Carregando.tsx — o "carregando" da plataforma: flechas girando, a
// frase do que está vindo e, se passar do normal, um aviso de que ainda estamos buscando.
//
// Existe porque as telas pesadas (oportunidades, vencedores, fornecedores…) mostravam só
// retângulos piscando, ou nada, enquanto o banco respondia; com a base grande isso leva
// vários segundos, e a pessoa não sabia se a tela tinha travado. É o mesmo estilo do quadro
// do chat oficial no Radar, para a plataforma inteira falar do mesmo jeito.

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCw } from 'lucide-react'

export function Carregando({
  texto = 'Carregando…',
  demoraMs = 12_000,
  avisoDemora = 'Está demorando mais que o normal. Continuamos buscando, a base é grande.',
  compacto = false,
  className,
}: {
  /** O que está vindo: "Carregando oportunidades…". */
  texto?: string
  /** Depois deste tempo aparece o aviso de demora. */
  demoraMs?: number
  avisoDemora?: string
  /** Numa linha só, para cartões pequenos e KPIs. */
  compacto?: boolean
  className?: string
}) {
  const [demorou, setDemorou] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDemorou(true), demoraMs)
    return () => clearTimeout(t)
  }, [demoraMs])

  if (compacto) {
    return (
      <span role="status" className={clsx('inline-flex items-center gap-1.5 text-[12px] text-muted', className)}>
        <RefreshCw size={13} className="animate-spin text-accent flex-shrink-0" aria-hidden />
        {texto}
      </span>
    )
  }
  return (
    <div role="status" className={clsx('flex flex-col items-center justify-center text-center py-10 px-6', className)}>
      <RefreshCw size={22} className="animate-spin text-accent mb-2.5" aria-hidden />
      <p className="text-[13px] text-strong font-semibold">{texto}</p>
      {demorou && <p className="text-[12px] text-muted mt-1.5 max-w-[380px] leading-snug">{avisoDemora}</p>}
    </div>
  )
}
