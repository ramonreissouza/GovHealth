'use client'
// src/components/ui/IADesativada.tsx
// Placeholder exibido nas páginas de IA enquanto IA_HABILITADA é false
// (sem provedor de LLM definido). Reversível via src/lib/features.ts.

import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { Sparkles } from 'lucide-react'

export function IADesativada({ title }: { title: string }) {
  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} subtitle="Recurso de IA temporariamente desativado" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center max-w-[460px]">
            <div className="w-12 h-12 rounded-xl bg-bg4 flex items-center justify-center mx-auto mb-4">
              <Sparkles size={22} className="text-faint" />
            </div>
            <h2 className="text-[16px] font-semibold text-strong">Recurso de IA desativado</h2>
            <p className="text-[13px] text-muted mt-2 leading-relaxed">
              As funcionalidades de IA estão temporariamente desativadas enquanto o provedor
              de modelo de linguagem não é definido. Nenhuma chamada externa é realizada.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
