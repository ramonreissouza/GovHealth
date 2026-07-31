'use client'
// src/components/ui/SetupFilterHint.tsx
// Avisa, na região dos filtros, que a tela já vem PRÉ-FILTRADA pelo Setup da Empresa
// (estados e/ou categorias de interesse). Só aparece quando o Setup realmente define
// os campos relevantes para aquela tela. Reage à hidratação da conta.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { SlidersHorizontal } from 'lucide-react'
import { getEmpresa, categoriasDoSetup } from '@/lib/empresa'
import { categoriasMercadoDoSetup, CATEGORIA_LABEL } from '@/lib/categoria-mercado'
import { HYDRATED_EVENT } from '@/lib/synced'

export function SetupFilterHint({
  estados = false,
  categorias = false,
  className,
}: {
  estados?: boolean       // a tela pré-filtra pelos ESTADOS do Setup
  categorias?: boolean    // a tela pré-filtra pelas CATEGORIAS do Setup
  className?: string
}) {
  const [ufs, setUfs] = useState<string[]>([])
  const [cats, setCats] = useState<string[]>([])

  useEffect(() => {
    const run = () => {
      const e = getEmpresa()
      setUfs(estados ? e.ufs : [])
      setCats(categorias ? categoriasMercadoDoSetup(categoriasDoSetup(e)) : [])
    }
    run()
    window.addEventListener(HYDRATED_EVENT, run)
    return () => window.removeEventListener(HYDRATED_EVENT, run)
  }, [estados, categorias])

  if (ufs.length === 0 && cats.length === 0) return null

  const partes: string[] = []
  if (ufs.length) partes.push(`estados: ${ufs.join(', ')}`)
  if (cats.length) partes.push(`categorias: ${cats.map((c) => CATEGORIA_LABEL[c] ?? c).join(', ')}`)

  return (
    <div className={clsx('flex items-center gap-2 flex-wrap bg-accent/5 border border-accent/20 rounded-lg px-3 py-2', className)}>
      <SlidersHorizontal size={13} className="text-accent flex-shrink-0" />
      <span className="text-[11px] text-muted">
        Filtrado pelo <span className="text-strong font-semibold">Setup da Empresa</span> — {partes.join(' · ')}.
      </span>
      <Link href="/perfil" className="text-[11px] font-mono-custom text-accent hover:underline ml-auto">ajustar setup →</Link>
    </div>
  )
}
