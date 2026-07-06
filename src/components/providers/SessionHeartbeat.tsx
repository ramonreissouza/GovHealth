'use client'
// src/components/providers/SessionHeartbeat.tsx
// Mantém a sessão única "viva" enquanto o app está aberto. Se esta sessão for
// superada (ok:false), desloga. Não renderiza nada.

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'

export default function SessionHeartbeat() {
  const { status } = useSession()
  useEffect(() => {
    if (status !== 'authenticated') return
    let vivo = true
    const ping = async () => {
      try {
        const r = await fetch('/api/sessao/heartbeat', { method: 'POST' })
        if (!vivo || r.status !== 200) return
        const j = await r.json().catch(() => ({}))
        if (j && j.ok === false) signOut({ callbackUrl: '/login?motivo=sessao' })
      } catch { /* offline: ignora */ }
    }
    ping()
    const id = setInterval(ping, 3 * 60_000)
    return () => { vivo = false; clearInterval(id) }
  }, [status])
  return null
}
