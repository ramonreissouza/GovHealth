'use client'
// src/components/PageViewTracker.tsx — registra a página vista pelo usuário LOGADO
// (para o dashboard do admin: "o que é mais acessado"). Não rastreia rotas
// públicas nem a própria área admin. Best-effort.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

const IGNORAR = ['/login', '/inicio', '/metodologia', '/assinar', '/admin']

export default function PageViewTracker() {
  const pathname = usePathname()
  const { status } = useSession()
  const ultima = useRef<string>('')

  useEffect(() => {
    if (status !== 'authenticated' || !pathname) return
    if (IGNORAR.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return
    if (ultima.current === pathname) return
    ultima.current = pathname
    fetch('/api/track', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rota: pathname }), keepalive: true,
    }).catch(() => {})
  }, [pathname, status])

  return null
}
