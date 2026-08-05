'use client'
// src/components/ui/SetupFilterHint.tsx
// Avisa, na região dos filtros, que a tela já vem PRÉ-FILTRADA pelo Setup da Empresa
// (estados e/ou categorias de interesse). Só aparece quando o Setup realmente define
// os campos relevantes para aquela tela. Reage à hidratação da conta.
//
// Também é o lugar do "tirar todos os filtros": o pré-filtro do Setup é bom como
// padrão, mas escondia o resto da base sem oferecer uma saída — o usuário tinha de
// descobrir sozinho que precisava clicar "todos" no filtro de UF E no de categoria.
// Passando onLimpar/onRestaurar, o aviso vira o interruptor: um clique tira tudo, e o
// mesmo lugar oferece o caminho de volta. Sem esses callbacks o componente segue
// sendo só o aviso de antes.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { SlidersHorizontal, Eye, Undo2 } from 'lucide-react'
import { getEmpresa, categoriasDoSetup } from '@/lib/empresa'
import { categoriasMercadoDoSetup, CATEGORIA_LABEL } from '@/lib/categoria-mercado'
import { HYDRATED_EVENT } from '@/lib/synced'

export function SetupFilterHint({
  estados = false,
  categorias = false,
  className,
  onLimpar,
  onRestaurar,
  limpo = false,
}: {
  estados?: boolean       // a tela pré-filtra pelos ESTADOS do Setup
  categorias?: boolean    // a tela pré-filtra pelas CATEGORIAS do Setup
  className?: string
  onLimpar?: () => void      // tira o pré-filtro do Setup (mostra tudo)
  onRestaurar?: () => void   // reaplica o Setup
  limpo?: boolean            // a tela está mostrando tudo (sem o pré-filtro)
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

  // Sem Setup definido não há o que avisar nem o que tirar — exceto quando a tela já
  // está no modo "mostrando tudo", em que o caminho de volta ainda precisa aparecer.
  if (ufs.length === 0 && cats.length === 0 && !limpo) return null

  if (limpo) {
    return (
      <div className={clsx('flex items-center gap-2 flex-wrap bg-surface border border-subtle rounded-lg px-3 py-2', className)}>
        <Eye size={13} className="text-muted flex-shrink-0" />
        <span className="text-[11px] text-muted">
          Mostrando <span className="text-strong font-semibold">tudo</span> — o filtro do Setup da Empresa está desligado.
        </span>
        {onRestaurar && (
          <button
            onClick={onRestaurar}
            className="text-[11px] font-mono-custom text-accent hover:underline ml-auto inline-flex items-center gap-1"
          >
            <Undo2 size={11} /> voltar ao meu setup
          </button>
        )}
      </div>
    )
  }

  const partes: string[] = []
  if (ufs.length) partes.push(`estados: ${ufs.join(', ')}`)
  if (cats.length) partes.push(`categorias: ${cats.map((c) => CATEGORIA_LABEL[c] ?? c).join(', ')}`)

  return (
    <div className={clsx('flex items-center gap-2 flex-wrap bg-accent/5 border border-accent/20 rounded-lg px-3 py-2', className)}>
      <SlidersHorizontal size={13} className="text-accent flex-shrink-0" />
      <span className="text-[11px] text-muted">
        Filtrado pelo <span className="text-strong font-semibold">Setup da Empresa</span> — {partes.join(' · ')}.
      </span>
      <div className="flex items-center gap-3 ml-auto">
        {onLimpar && (
          <button
            onClick={onLimpar}
            className="text-[11px] font-mono-custom text-accent hover:underline inline-flex items-center gap-1"
          >
            <Eye size={11} /> tirar todos os filtros
          </button>
        )}
        <Link href="/perfil" className="text-[11px] font-mono-custom text-accent hover:underline">ajustar setup →</Link>
      </div>
    </div>
  )
}
