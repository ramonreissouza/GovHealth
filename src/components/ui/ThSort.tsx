'use client'
// src/components/ui/ThSort.tsx — cabeçalho de tabela clicável (ordena asc/desc).
//
// Fonte ÚNICA da ordenação das tabelas do produto (Licitações, Vencedores,
// Contratos). Existe para as telas não reimplementarem cada uma o seu próprio
// `sort` — o que garantiria três comportamentos diferentes para nulo, três
// tratamentos de empate e três setinhas com aparência distinta.
//
// Uso:
//   const { ordem, alternar } = useOrdenacao<'valor' | 'score'>()
//   <ThSort chave="valor" ordem={ordem} onOrdenar={alternar} align="right">Valor</ThSort>
//   const linhas = ordenarPor(dados, ordem, { valor: (d) => d.valor, score: (d) => d.score })

import { useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

export type DirOrdem = 'asc' | 'desc'

export interface Ordem<K extends string> {
  /** null = sem ordenação do usuário; vale a ordem que o servidor devolveu. */
  chave: K | null
  dir: DirOrdem
}

export function useOrdenacao<K extends string>(inicial?: Ordem<K>) {
  const [ordem, setOrdem] = useState<Ordem<K>>(inicial ?? { chave: null, dir: 'desc' })

  const alternar = useCallback((chave: K) => {
    setOrdem((o) => {
      // Primeiro clique numa coluna nova entra em DESC de propósito: em valor e em
      // score o que interessa é o topo ("as maiores", "as melhores"). Começar em ASC
      // mostraria as piores oportunidades primeiro — um clique sempre desperdiçado.
      if (o.chave !== chave) return { chave, dir: 'desc' }
      if (o.dir === 'desc') return { chave, dir: 'asc' }
      // Terceiro clique DESLIGA e devolve a ordem do servidor (relevância/data),
      // que é uma informação real e não teria como ser recuperada de outro jeito.
      return { chave: null, dir: 'desc' }
    })
  }, [])

  return { ordem, alternar, setOrdem }
}

type Valor = number | string | null | undefined
type Acessores<T, K extends string> = Partial<Record<K, (linha: T) => Valor>>

/**
 * Devolve uma NOVA lista ordenada (não muta a entrada). Sem chave ativa, devolve a
 * lista como veio.
 */
export function ordenarPor<T, K extends string>(
  linhas: T[], ordem: Ordem<K>, acessores: Acessores<T, K>,
): T[] {
  if (!ordem.chave) return linhas
  const pegar = acessores[ordem.chave]
  if (!pegar) return linhas

  const sinal = ordem.dir === 'asc' ? 1 : -1
  return [...linhas].sort((a, b) => {
    const va = pegar(a), vb = pegar(b)
    // Vazio vai SEMPRE para o fim, nas duas direções. Se seguisse o sinal, clicar
    // em "crescente" encheria a primeira tela de linhas com "—" (a base tem valor
    // nulo e score ausente) e a ordenação pareceria quebrada.
    const aVazio = va == null || va === ''
    const bVazio = vb == null || vb === ''
    if (aVazio && bVazio) return 0
    if (aVazio) return 1
    if (bVazio) return -1

    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sinal
    return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * sinal
  })
}

const BASE_TH = 'text-[9px] font-mono-custom text-faint uppercase tracking-wider'

export function ThSort<K extends string>({
  chave, ordem, onOrdenar, children, align = 'left', className,
}: {
  chave: K
  ordem: Ordem<K>
  onOrdenar: (chave: K) => void
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  const ativo = ordem.chave === chave
  const Seta = !ativo ? ChevronsUpDown : ordem.dir === 'desc' ? ChevronDown : ChevronUp

  return (
    <th
      className={clsx(BASE_TH, align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)}
      aria-sort={ativo ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onOrdenar(chave)}
        title={ativo && ordem.dir === 'desc' ? 'Ordenar crescente'
          : ativo ? 'Voltar à ordem original' : 'Ordenar decrescente'}
        className={clsx(
          'inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-strong',
          // Cabeçalho ativo fica destacado: sem isso, numa tabela larga a pessoa
          // rola e perde de vista por qual coluna a lista está ordenada.
          ativo ? 'text-accent' : 'text-faint',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {children}
        <Seta size={11} className={clsx('flex-shrink-0', !ativo && 'opacity-40')} />
      </button>
    </th>
  )
}
