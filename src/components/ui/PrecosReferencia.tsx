'use client'
// src/components/ui/PrecosReferencia.tsx
// Painel compacto de preços de referência do Compras.gov — usado nos detalhes de licitação

import React, { useState, useEffect } from 'react'
import { TrendingDown, ExternalLink, RefreshCw } from 'lucide-react'
import type { PrecoPainelItem, EstatisticaPrecos } from '@/lib/types'
import { formatBRL } from '@/lib/format'

interface Props {
  termo: string           // descrição do item da licitação
  uf?: string
}

function formatDate(s: string) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) }
  catch { return s }
}

export function PrecosReferencia({ termo, uf }: Props) {
  const [precos, setPrecos]   = useState<PrecoPainelItem[]>([])
  const [stats, setStats]     = useState<EstatisticaPrecos | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    if (!termo) { setLoading(false); return }

    // Extrai até 3 palavras relevantes do termo para não sobrecarregar a query
    const palavras = termo
      .toLowerCase()
      .replace(/[^a-záàâãéêíóôõúüç\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 3)
      .join(' ')

    const query = palavras || termo.slice(0, 30)
    const params = new URLSearchParams({ descricao: query, tamanhoPagina: '10' })
    if (uf) params.set('uf', uf)

    fetch(`/api/comprasgov/precos?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPrecos(data.precos ?? [])
        setStats(data.estatisticas ?? null)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [termo, uf])

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-faint py-1">
        <RefreshCw size={11} className="animate-spin" />
        Buscando preços de referência no Compras.gov…
      </div>
    )
  }

  if (error || precos.length === 0) {
    return (
      <div className="text-[11px] text-faint py-1">
        Sem referência de preço no Compras.gov para este item.
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">
        <TrendingDown size={11} />
        Preços de referência — Compras.gov
      </div>

      {/* Stats strip */}
      {stats && stats.total > 0 && (
        <div className="flex gap-4 mb-2.5 flex-wrap">
          {[
            { label: 'Menor',   value: formatBRL(stats.valorMin),    color: 'text-emerald-400' },
            { label: 'Médio',   value: formatBRL(stats.valorMedio),  color: 'text-strong' },
            { label: 'Mediana', value: formatBRL(stats.valorMediano),color: 'text-accent' },
            { label: 'Maior',   value: formatBRL(stats.valorMax),    color: 'text-brand-red' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className="text-[9px] font-mono-custom text-faint uppercase">{label}</div>
              <div className={`text-[13px] font-mono-custom font-bold ${color}`}>{value}</div>
            </div>
          ))}
          <div className="text-center">
            <div className="text-[9px] font-mono-custom text-faint uppercase">Registros</div>
            <div className="text-[13px] font-mono-custom font-bold text-strong">{stats.total}</div>
          </div>
        </div>
      )}

      {/* Recent records */}
      <div className="space-y-1">
        {precos.slice(0, 5).map((p, i) => (
          <div key={`${p.id}-${i}`} className="flex items-center gap-3 px-2 py-1.5 bg-bg4/40 rounded-lg">
            <span className={`text-[11px] font-mono-custom font-bold flex-shrink-0 w-24 ${
              p.valorUnitario <= (stats?.valorMedio ?? Infinity) ? 'text-emerald-400' : 'text-amber'
            }`}>
              {formatBRL(p.valorUnitario)}
            </span>
            <span className="text-[10px] text-muted flex-1 truncate">{p.razaoSocialFornecedor || '—'}</span>
            <span className="text-[9px] font-mono-custom text-faint flex-shrink-0">{p.siglaUf}</span>
            <span className="text-[9px] font-mono-custom text-faint flex-shrink-0">{formatDate(p.dataResultado)}</span>
            <span className={`text-[8px] font-mono-custom px-1 py-0.5 rounded uppercase flex-shrink-0 ${
              p.tipoCompra === 'privada'
                ? 'bg-amber-500/15 text-amber-400'
                : 'bg-emerald-500/15 text-emerald-400'
            }`}>
              {p.tipoCompra === 'privada' ? 'PRIV' : 'PÚB'}
            </span>
          </div>
        ))}
      </div>

      <a
        href={`/precos?q=${encodeURIComponent(termo)}`}
        className="inline-flex items-center gap-1 text-[10px] font-mono-custom text-faint hover:text-accent transition-colors mt-2"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink size={9} />
        Ver todos no Painel de Preços
      </a>
    </div>
  )
}
