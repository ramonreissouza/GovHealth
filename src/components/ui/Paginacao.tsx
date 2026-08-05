'use client'
// src/components/ui/Paginacao.tsx — paginação NUMERADA, compartilhada pelas listas.
//
// Substitui o "Mostrar mais 50", que tinha dois problemas: acumulava linhas na tela
// (a 4ª leva de uma lista de 50 mil deixava a página pesada) e não dava noção de
// tamanho nem como voltar — para rever a página 2 o usuário recarregava tudo.
//
// A régua mostra sempre a primeira e a última página, a atual com um vizinho de cada
// lado, e reticências no meio: 1 … 4 5 6 … 21. Assim a largura é constante, tenha a
// lista 3 ou 300 páginas.

import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Números a exibir, com `null` marcando cada corte de reticências. */
export function janelaDePaginas(atual: number, total: number, vizinhos = 1): Array<number | null> {
  // Até 7 páginas cabem inteiras — reticências aqui só atrapalhariam.
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const paginas = new Set<number>([1, total])
  for (let p = atual - vizinhos; p <= atual + vizinhos; p++) {
    if (p >= 1 && p <= total) paginas.add(p)
  }
  // Sem isto a régua "pula" de largura ao navegar perto das pontas.
  if (atual <= 3) { paginas.add(2); paginas.add(3); paginas.add(4) }
  if (atual >= total - 2) { paginas.add(total - 1); paginas.add(total - 2); paginas.add(total - 3) }
  const ord = [...paginas].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: Array<number | null> = []
  let anterior = 0
  for (const p of ord) {
    if (anterior && p - anterior > 1) out.push(null)
    out.push(p)
    anterior = p
  }
  return out
}

export function Paginacao({
  pagina,
  totalItens,
  porPagina,
  onPagina,
  rotuloItens = 'registros',
  className,
}: {
  pagina: number
  totalItens: number
  porPagina: number
  onPagina: (p: number) => void
  rotuloItens?: string
  className?: string
}) {
  const totalPaginas = Math.max(1, Math.ceil(totalItens / porPagina))
  const primeiro = totalItens === 0 ? 0 : (pagina - 1) * porPagina + 1
  const ultimo = Math.min(pagina * porPagina, totalItens)

  // Uma página só: a contagem ainda ajuda, os controles não.
  const soUma = totalPaginas <= 1

  const ir = (p: number) => { if (p >= 1 && p <= totalPaginas && p !== pagina) onPagina(p) }

  const btn = 'text-[11px] font-mono-custom min-w-[26px] h-[26px] px-1.5 rounded-md transition-all inline-flex items-center justify-center'

  return (
    <div className={clsx('flex items-center justify-between gap-3 flex-wrap px-3 py-2.5', className)}>
      <span className="text-[11px] text-faint font-mono-custom">
        {totalItens === 0
          ? `Nenhum ${rotuloItens.replace(/s$/, '')}`
          : <>{primeiro}–{ultimo} de <span className="text-muted">{totalItens.toLocaleString('pt-BR')}</span> {rotuloItens}</>}
      </span>

      {!soUma && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => ir(pagina - 1)}
            disabled={pagina === 1}
            aria-label="Página anterior"
            className={clsx(btn, pagina === 1 ? 'text-faint/40 cursor-not-allowed' : 'text-muted hover:text-strong hover:bg-bg3')}
          >
            <ChevronLeft size={13} />
          </button>

          {janelaDePaginas(pagina, totalPaginas).map((p, i) =>
            p === null ? (
              <span key={`e${i}`} className="text-[11px] text-faint px-0.5 select-none">…</span>
            ) : (
              <button
                key={p}
                onClick={() => ir(p)}
                aria-label={`Página ${p}`}
                aria-current={p === pagina ? 'page' : undefined}
                className={clsx(btn, p === pagina
                  ? 'bg-accent text-black font-bold'
                  : 'text-muted hover:text-strong hover:bg-bg3')}
              >
                {p}
              </button>
            ),
          )}

          <button
            onClick={() => ir(pagina + 1)}
            disabled={pagina === totalPaginas}
            aria-label="Próxima página"
            className={clsx(btn, pagina === totalPaginas ? 'text-faint/40 cursor-not-allowed' : 'text-muted hover:text-strong hover:bg-bg3')}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
