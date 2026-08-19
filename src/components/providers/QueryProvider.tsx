'use client'
// src/components/providers/QueryProvider.tsx
// QueryClient único por sessão de browser (useState lazy-init, não recriar a cada
// render). staleTime/gcTime generosos: trocar de página/filtro já visitado em
// Licitações deve vir do cache, não refazer a query.

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
