'use client'
// src/components/layout/Topbar.tsx

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { Bell, RefreshCw } from 'lucide-react'
import { IA_HABILITADA } from '@/lib/features'

interface TopbarProps {
  title: string
  subtitle?: string
}

export default function Topbar({ title, subtitle }: TopbarProps) {
  const router = useRouter()
  const [lastUpdate, setLastUpdate] = useState<string>('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    setLastUpdate(getRelativeTime(new Date()))
    const interval = setInterval(() => setLastUpdate(getRelativeTime(new Date())), 60_000)
    return () => clearInterval(interval)
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
        {/* Status */}
        <div className="flex items-center gap-1.5 text-[11px] text-faint font-mono-custom">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
          <span>Atualizado {lastUpdate}</span>
        </div>

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

function getRelativeTime(date: Date): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (diff < 1) return 'agora'
  if (diff === 1) return 'há 1 min'
  if (diff < 60) return `há ${diff} min`
  return `há ${Math.floor(diff / 60)}h`
}
