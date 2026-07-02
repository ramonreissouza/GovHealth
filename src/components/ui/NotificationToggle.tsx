'use client'
// src/components/ui/NotificationToggle.tsx — liga/desliga as notificações do
// navegador (item #5). Pede permissão ao ativar; mostra o estado atual.

import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { clsx } from 'clsx'
import {
  notificationsSupported, notificationPermission, requestNotificationPermission,
  getNotifyEnabled, setNotifyEnabled,
} from '@/lib/notifications'

export default function NotificationToggle() {
  const [mounted, setMounted] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    setMounted(true)
    setEnabled(getNotifyEnabled())
    setPerm(notificationPermission())
  }, [])

  if (!mounted) return null

  if (perm === 'unsupported') {
    return <span className="text-[11px] text-faint">Navegador sem suporte a notificações</span>
  }

  async function alternar() {
    if (enabled) {
      setNotifyEnabled(false)
      setEnabled(false)
      return
    }
    const p = await requestNotificationPermission()
    setPerm(p)
    if (p === 'granted') {
      setNotifyEnabled(true)
      setEnabled(true)
    }
  }

  const ativo = enabled && perm === 'granted'
  const bloqueado = perm === 'denied'

  return (
    <button
      onClick={alternar}
      disabled={bloqueado}
      title={bloqueado ? 'Notificações bloqueadas nas configurações do navegador' : undefined}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border transition-colors',
        bloqueado ? 'border-subtle text-faint cursor-not-allowed'
          : ativo ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-subtle text-muted hover:text-strong hover:border-subtle2',
      )}
    >
      {bloqueado ? <BellOff size={14} /> : ativo ? <BellRing size={14} /> : <Bell size={14} />}
      {bloqueado ? 'Notificações bloqueadas' : ativo ? 'Notificações ativas' : 'Ativar notificações'}
    </button>
  )
}
