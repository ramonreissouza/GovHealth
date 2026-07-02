'use client'
// src/components/dashboard/ConcorrentesWidget.tsx
// Top fornecedores (concorrentes) por valor homologado — dados REAIS do banco (ETL),
// via /api/resultados/fornecedores. Cada linha é clicável e leva ao ranking completo.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatBRLCompact as formatBRL } from '@/lib/format'

interface RankingRow {
  fornecedor: string | null
  cnpj: string | null
  valor: number
  itens: number
  ufs: number
}

export default function ConcorrentesWidget({ uf, tipo }: { uf?: string; tipo?: string }) {
  const [ranking, setRanking] = useState<RankingRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '5' })
    if (uf) params.set('uf', uf)
    if (tipo) params.set('tipo', tipo)
    fetch(`/api/resultados/fornecedores?${params}`)
      .then((r) => r.json())
      .then((d) => setRanking(d.ranking ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [uf, tipo])

  const maxValor = ranking[0]?.valor ?? 1

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 bg-bg4 rounded-md animate-pulse" />
        ))}
      </div>
    )
  }

  if (ranking.length === 0) {
    return <p className="text-[11px] text-faint py-2">Sem dados disponíveis no período.</p>
  }

  return (
    <>
      <div className="space-y-1">
        {ranking.slice(0, 4).map((v, i) => (
          <Link
            key={v.fornecedor ?? i}
            href={`/fornecedores?q=${encodeURIComponent(v.fornecedor ?? '')}`}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 hover:bg-bg3 transition-colors group"
          >
            <span className="text-[11px] text-faint font-mono-custom w-4">{i + 1}</span>
            <div className="w-7 h-7 rounded-md bg-bg4 border border-subtle2 flex items-center justify-center text-[9px] font-semibold text-muted flex-shrink-0">
              {(v.fornecedor ?? '?').substring(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <span className="block text-[12px] text-strong truncate group-hover:text-accent transition-colors">
                {v.fornecedor ?? 'N/D'}
              </span>
              <span className="block text-[9px] text-faint font-mono-custom">
                {v.itens} {v.itens === 1 ? 'item' : 'itens'} · {v.ufs} {v.ufs === 1 ? 'UF' : 'UFs'}
              </span>
            </div>
            <span className="text-[10px] font-mono-custom text-faint flex-shrink-0">
              {formatBRL(v.valor)}
            </span>
            <div className="w-10 h-1 bg-bg4 rounded-full overflow-hidden flex-shrink-0">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(v.valor / maxValor) * 100}%` }} />
            </div>
          </Link>
        ))}
      </div>
      <Link
        href="/fornecedores"
        className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
      >
        Ver ranking completo <ArrowRight size={12} />
      </Link>
    </>
  )
}
