'use client'
// src/components/layout/Topbar.tsx

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { Bell, RefreshCw } from 'lucide-react'
import { IA_HABILITADA } from '@/lib/features'
import { subscribeDataStatus, getDataStatus, tempoDesde, type DataStatus } from '@/lib/data-status'

interface TopbarProps {
  title: string
  subtitle?: string
}

export default function Topbar({ title, subtitle }: TopbarProps) {
  const router = useRouter()
  const [status, setStatus] = useState<DataStatus | null>(getDataStatus())
  const [, forceTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const unsub = subscribeDataStatus(setStatus)
    // re-renderiza a cada minuto para o "há Xh" avançar mesmo sem nova coleta
    const interval = setInterval(() => forceTick((t) => t + 1), 60_000)
    return () => { unsub(); clearInterval(interval) }
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    router.refresh()
    setTimeout(() => setRefreshing(false), 1500)
  }

  return (
    <header className="h-[52px] border-b border-subtle bg-bg2 flex items-center px-6 gap-4 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <span className="font-heading font-semibold text-[15px] text-strong">{title}</span>
        {subtitle && (
          <span className="ml-3 text-[12px] text-faint font-mono-custom">{subtitle}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Selo de proveniência/atualidade — reflete a coleta REAL do dado (item 9).
            Só aparece quando uma tela publicou o status; nunca inventa horário. */}
        {status ? (
          <div
            className="flex items-center gap-1.5 text-[11px] text-faint font-mono-custom"
            title={`Fonte: ${status.fonte} · coletado em ${new Date(status.atualizadoEm).toLocaleString('pt-BR')}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span>{status.fonte} · coletado {tempoDesde(status.atualizadoEm)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-faint font-mono-custom">
            <span className="w-1.5 h-1.5 rounded-full bg-bg4" />
            <span>Dados ao vivo</span>
          </div>
        )}

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          className={clsx(
            'p-1.5 rounded-md text-faint hover:text-strong hover:bg-bg3 transition-all',
            refreshing && 'text-accent'
          )}
          title="Atualizar dados"
        >
          <RefreshCw size={14} className={clsx(refreshing && 'animate-spin')} />
        </button>

        {/* Alerts */}
        <button className="relative p-1.5 rounded-md text-faint hover:text-strong hover:bg-bg3 transition-all">
          <Bell size={14} />
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-red rounded-full" />
        </button>

        {/* CTA — escondido enquanto a IA está desativada */}
        {IA_HABILITADA && (
          <button
            onClick={() => router.push('/copiloto')}
            className="px-3 py-1.5 bg-accent hover:bg-accent2 text-black text-[12px] font-semibold rounded-md transition-colors"
          >
            Perguntar à IA ↗
          </button>
        )}
      </div>
    </header>
  )
}
