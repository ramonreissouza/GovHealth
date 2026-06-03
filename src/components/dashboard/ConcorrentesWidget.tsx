'use client'
// src/components/dashboard/ConcorrentesWidget.tsx

import { useState, useEffect } from 'react'
import type { VencedorAgregado } from '@/app/api/vencedores/route'
import { formatBRLCompact as formatBRL } from '@/lib/format'

export default function ConcorrentesWidget() {
  const [vencedores, setVencedores] = useState<VencedorAgregado[]>([])
  const [loading, setLoading] = useState(true)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    fetch('/api/vencedores')
      .then((r) => r.json())
      .then((d) => {
        setVencedores(d.vencedores ?? [])
        setFallback(d.fallback ?? false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const maxValor = vencedores[0]?.valor ?? 1

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 bg-bg4 rounded-md animate-pulse" />
        ))}
      </div>
    )
  }

  if (vencedores.length === 0) {
    return <p className="text-[11px] text-faint py-2">Sem dados disponíveis no período.</p>
  }

  return (
    <>
      {fallback && (
        <p className="text-[9px] font-mono-custom text-amber-400 mb-2">
          proxy: maiores compradores
        </p>
      )}
      <div className="space-y-2">
        {vencedores.slice(0, 4).map((v, i) => (
          <div key={v.id} className="flex items-center gap-2">
            <span className="text-[11px] text-faint font-mono-custom w-4">{i + 1}</span>
            <div className="w-7 h-7 rounded-md bg-bg4 border border-subtle2 flex items-center justify-center text-[9px] font-semibold text-muted flex-shrink-0">
              {v.nome.substring(0, 2).toUpperCase()}
            </div>
            <span className="flex-1 text-[12px] text-strong truncate min-w-0">{v.nome}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-12 h-1 bg-bg4 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(v.valor / maxValor) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono-custom text-faint w-14 text-right">
                {formatBRL(v.valor)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
