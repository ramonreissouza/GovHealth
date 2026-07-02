'use client'
// src/components/NotificationsWatcher.tsx — vigia global de alertas (item #5).
// Enquanto o usuário está logado e com notificações ligadas, consulta /api/alerts
// periodicamente e dispara uma notificação do navegador para os alertas NOVOS.
// Dedup por chave estável (tipo+descrição) — as emendas têm id aleatório por
// request, então a descrição é a âncora estável. Na primeira execução apenas
// "semeia" o que já existe (sem notificar), para não despejar um backlog.

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { canNotify, showBrowserNotification } from '@/lib/notifications'

const SEEN_KEY = 'govhealth:notify-seen'
const INIT_KEY = 'govhealth:notify-init'
const POLL_MS = 60_000

interface AlertaApi { tipo?: string; titulo?: string; descricao?: string; href?: string }

function chave(a: AlertaApi): string {
  return `${a.tipo ?? ''}:${(a.descricao ?? '').slice(0, 90)}`
}

export default function NotificationsWatcher() {
  const { status } = useSession()
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelado = false

    async function tick() {
      if (!canNotify()) return
      try {
        const r = await fetch('/api/alerts')
        if (!r.ok) return
        const data = await r.json()
        const alerts: AlertaApi[] = data.alerts ?? []
        const keys = alerts.map(chave)

        const seen: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
        const seenSet = new Set(seen)

        // Primeira vez: semeia sem notificar.
        if (localStorage.getItem(INIT_KEY) !== '1') {
          localStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(0, 300)))
          localStorage.setItem(INIT_KEY, '1')
          return
        }

        const novos = alerts.filter((_, i) => !seenSet.has(keys[i]))
        for (const a of novos.slice(0, 3)) {
          showBrowserNotification(`GovHealth: ${a.titulo || 'Novo alerta'}`, {
            body: a.descricao,
            tag: chave(a),
            url: a.href,
          })
        }

        // Persiste o conjunto visto (cap 300, mais recentes primeiro).
        const merged = [...new Set([...keys, ...seen])].slice(0, 300)
        localStorage.setItem(SEEN_KEY, JSON.stringify(merged))
      } catch {
        /* offline / sem sessão — ignora silenciosamente */
      }
    }

    tick()
    timer.current = setInterval(() => { if (!cancelado) tick() }, POLL_MS)
    return () => {
      cancelado = true
      if (timer.current) clearInterval(timer.current)
    }
  }, [status])

  return null
}
