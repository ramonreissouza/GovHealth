'use client'
// src/components/dashboard/AlertsFeed.tsx

import { useEffect, useState } from 'react'
import { Alert } from '@/lib/types'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const TIPO_CONFIG = {
  edital: { label: 'EDITAL', variant: 'tag-green', border: 'border-accent/20' },
  concorrente: { label: 'CONCORRENTE', variant: 'tag-red', border: 'border-red/20' },
  emenda: { label: 'EMENDA', variant: 'tag-amber', border: 'border-amber/20' },
  vencimento: { label: 'VENCIMENTO', variant: 'tag-purple', border: 'border-purple/20' },
  oportunidade: { label: 'OPORTUNIDADE', variant: 'tag-blue', border: 'border-blue/20' },
}

const FALLBACK_ALERTS: Alert[] = [
  {
    id: 'empty',
    tipo: 'oportunidade',
    titulo: 'Sem alertas recentes',
    descricao: 'Nenhum edital ou emenda parlamentar de saúde encontrado nas últimas 48h. Os dados são atualizados a cada 10 minutos.',
    urgencia: 'normal',
    createdAt: new Date().toISOString(),
    lida: false,
  },
]

export default function AlertsFeed() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/alerts')
      .then((r) => r.json())
      .then((data) => {
        const list = data.alerts ?? []
        setAlerts(list.length > 0 ? list : FALLBACK_ALERTS)
      })
      .catch(() => setAlerts(FALLBACK_ALERTS))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-bg3 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {alerts.slice(0, 5).map((alert) => {
        const config = TIPO_CONFIG[alert.tipo]
        return (
          <div
            key={alert.id}
            className={clsx(
              'bg-bg3 rounded-lg p-3 border',
              config.border
            )}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className={clsx('text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full', config.variant)}>
                {config.label}
              </span>
              <span className="text-[10px] text-faint font-mono-custom">
                {formatDistanceToNow(new Date(alert.createdAt), { locale: ptBR, addSuffix: true })}
              </span>
            </div>
            <p className="text-[12px] text-strong leading-relaxed">
              {alert.descricao}
            </p>
          </div>
        )
      })}
    </div>
  )
}
