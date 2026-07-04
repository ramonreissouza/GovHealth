'use client'
// src/components/ui/PrecoRefItem.tsx
// Preço de referência do Compras.gov POR ITEM, sob demanda (carrega ao clicar).
// Consulta pela descrição do item (mais específica que o objeto da licitação) e
// compara com o valor unitário orçado. Marcado como APROXIMADO: sem código CATMAT
// nos nossos dados, a resolução é por texto e as unidades podem variar.

import React, { useState } from 'react'
import { TrendingDown, RefreshCw, ChevronDown, ChevronUp, ExternalLink, AlertTriangle } from 'lucide-react'
import type { EstatisticaPrecos } from '@/lib/types'
import { formatBRL } from '@/lib/format'

// Extrai os termos mais específicos do item (primeiras palavras ≥4 letras) para a
// resolução do catálogo — evita mandar a descrição inteira (ruído).
function extrairTermo(descricao: string): string {
  const p = descricao
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúüç\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3)
    .join(' ')
  return p || descricao.slice(0, 30)
}

export function PrecoRefItem({ descricao, valorUnitario, uf }: { descricao: string; valorUnitario: number; uf?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [carregado, setCarregado] = useState(false)
  const [stats, setStats] = useState<EstatisticaPrecos | null>(null)

  const termo = extrairTermo(descricao)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (carregado) { setOpen((o) => !o); return }
    setOpen(true); setLoading(true)
    try {
      const params = new URLSearchParams({ descricao: termo, tamanhoPagina: '30' })
      if (uf) params.set('uf', uf)
      const r = await fetch(`/api/comprasgov/precos?${params}`)
      const d = await r.json()
      setStats(d.estatisticas ?? null)
    } catch { /* silencioso */ }
    finally { setLoading(false); setCarregado(true) }
  }

  const mediana = stats?.valorMediano ?? 0
  const temDados = !!stats && stats.total > 0
  // Comparação orçado × mediana (aproximada — unidades podem diferir).
  const diff = temDados && mediana > 0 && valorUnitario > 0 ? (valorUnitario - mediana) / mediana : null

  return (
    <div className="mt-1">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 text-[9px] font-mono-custom text-faint hover:text-accent transition-colors"
      >
        {loading ? <RefreshCw size={9} className="animate-spin" /> : <TrendingDown size={9} />}
        Preço ref. Compras.gov
        {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {open && !loading && (
        <div className="mt-1 pl-2 border-l border-subtle2">
          {!temDados ? (
            <div className="text-[9px] font-mono-custom text-faint">Sem referência para este item.</div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap text-[9px] font-mono-custom">
                <span className="text-faint">mín <span className="text-emerald-400 font-bold">{formatBRL(stats!.valorMin)}</span></span>
                <span className="text-faint">mediana <span className="text-accent font-bold">{formatBRL(stats!.valorMediano)}</span></span>
                <span className="text-faint">máx <span className="text-brand-red font-bold">{formatBRL(stats!.valorMax)}</span></span>
                <span className="text-faint">({stats!.total} reg.)</span>
                {diff !== null && Math.abs(diff) < 50 && (
                  <span className={diff <= 0 ? 'text-emerald-400' : 'text-amber'}>
                    orçado {diff <= 0 ? 'abaixo' : 'acima'} {Math.abs(Math.round(diff * 100))}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[8px] font-mono-custom text-faint mt-0.5">
                <AlertTriangle size={8} className="text-amber flex-shrink-0" />
                aproximado — sem CATMAT, unidades podem variar
                <a
                  href={`/precos?q=${encodeURIComponent(termo)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 ml-1 hover:text-accent"
                >
                  <ExternalLink size={8} /> Painel de Preços
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
