'use client'
// src/components/providers/UserDataSync.tsx
// Hidrata os dados por conta (portfólio, CRM, alertas) a partir do servidor quando
// o usuário está autenticado. Não renderiza nada.

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { hydrateFromServer } from '@/lib/synced'

export default function UserDataSync() {
  const { data: session, status } = useSession()
  const hidratadoPara = useRef<string | null>(null)

  useEffect(() => {
    const email = session?.user?.email ?? null
    if (status === 'authenticated' && email && hidratadoPara.current !== email) {
      hidratadoPara.current = email
      void hydrateFromServer(email)
    }
  }, [status, session?.user?.email])

  return null
}
