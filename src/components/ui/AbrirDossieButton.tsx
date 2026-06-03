'use client'
// src/components/ui/AbrirDossieButton.tsx
// Cria (idempotente) o dossiê do edital a partir de uma Oportunidade e leva
// ao Workspace do Edital (/editais?id=...).

import { useState } from 'react'
import { FolderOpen, FilePlus2 } from 'lucide-react'
import { criarDeOportunidade, workspaceExists } from '@/lib/edital-workspace'
import type { Oportunidade } from '@/lib/types'

export function AbrirDossieButton({ oportunidade }: { oportunidade: Oportunidade }) {
  const [exists, setExists] = useState(
    () => typeof window !== 'undefined' && workspaceExists(oportunidade.id),
  )
  const href = `/editais?id=${encodeURIComponent(oportunidade.id)}`

  return (
    <a
      href={href}
      onClick={(e) => {
        e.stopPropagation()
        if (!exists) { criarDeOportunidade(oportunidade); setExists(true) }
      }}
      className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-faint hover:text-strong border border-subtle2 hover:border-accent/40 rounded-lg px-2.5 py-1 transition-all"
    >
      {exists ? <FolderOpen size={12} /> : <FilePlus2 size={12} />}
      {exists ? 'Abrir dossiê' : 'Criar dossiê do edital'}
    </a>
  )
}
