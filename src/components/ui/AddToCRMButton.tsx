'use client'
// src/components/ui/AddToCRMButton.tsx
// Botão que cria um deal no pipeline CRM a partir de uma Oportunidade

import { useState } from 'react'
import { Kanban, CheckCircle2 } from 'lucide-react'
import { createDeal, dealExists } from '@/lib/crm'
import type { Oportunidade } from '@/lib/types'

interface Props {
  oportunidade: Oportunidade
}

export function AddToCRMButton({ oportunidade }: Props) {
  const [state, setState] = useState<'idle' | 'added' | 'exists'>(() => {
    if (typeof window === 'undefined') return 'idle'
    return dealExists(oportunidade.id) ? 'exists' : 'idle'
  })

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state !== 'idle') return

    createDeal({
      oportunidadeId: oportunidade.id,
      titulo: oportunidade.descricao.slice(0, 60),
      hospital: oportunidade.hospital ?? oportunidade.municipio,
      municipio: oportunidade.municipio,
      uf: oportunidade.uf,
      descricao: oportunidade.descricao,
      valorEstimado: oportunidade.valorEstimado,
      score: oportunidade.score,
      categoria: oportunidade.categoria,
      stage: 'prospeccao',
      probabilidade: oportunidade.probabilidadeEdital
        ? Math.round(oportunidade.probabilidadeEdital * 100)
        : 50,
      licitacaoLink: oportunidade.licitacaoRelacionada?.linkSistemaOrigem ?? '',
    })

    setState('added')
  }

  if (state === 'exists') {
    return (
      <a
        href="/crm"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        <CheckCircle2 size={12} />
        No pipeline
      </a>
    )
  }

  if (state === 'added') {
    return (
      <a
        href="/crm"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-accent hover:text-accent/80 transition-colors"
      >
        <CheckCircle2 size={12} />
        Adicionado ao pipeline →
      </a>
    )
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-faint hover:text-strong border border-subtle2 hover:border-accent/40 rounded-lg px-2.5 py-1 transition-all"
    >
      <Kanban size={12} />
      Adicionar ao Pipeline CRM
    </button>
  )
}
