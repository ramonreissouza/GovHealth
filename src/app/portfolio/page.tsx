'use client'
// src/app/portfolio/page.tsx — Meu Portfólio foi unificado no Setup da Empresa.
// Mantido apenas como redirecionamento para não quebrar links/atalhos existentes
// (dashboard "Ajustar setup", filtro de oportunidades, etc.).

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { Loader2 } from 'lucide-react'

export default function PortfolioRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/perfil?tab=portfolio') }, [router])
  return (
    <div className="flex h-screen bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Meu Portfólio" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={22} className="animate-spin text-faint" />
        </div>
      </div>
    </div>
  )
}
