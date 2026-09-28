'use client'
// src/app/mapa/page.tsx

import dynamic from 'next/dynamic'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { Carregando } from '@/components/ui/Carregando'

const MapaLicitacoes = dynamic(
  () => import('@/components/map/MapaLicitacoes'),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Carregando texto="Carregando mapa…" />
      </div>
    ),
  }
)

export default function MapaPage() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Mapa de inteligência" subtitle="Licitações por localização · clique para detalhes" />
        <div className="flex-1 flex flex-col min-h-0">
          <MapaLicitacoes />
        </div>
      </div>
    </div>
  )
}
