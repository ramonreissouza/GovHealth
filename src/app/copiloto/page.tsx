// src/app/copiloto/page.tsx
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import ChatInterface from '@/components/copiloto/ChatInterface'
import { IA_HABILITADA } from '@/lib/features'
import { IADesativada } from '@/components/ui/IADesativada'

export default function CopilotoPage() {
  if (!IA_HABILITADA) return <IADesativada title="Copiloto IA" />
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Copiloto IA" subtitle="GPT-4 · dados PNCP + TransfereGov" />
        <main className="flex-1 overflow-hidden p-6 bg-bg">
          <div className="h-full max-w-3xl mx-auto flex flex-col">
            <ChatInterface />
          </div>
        </main>
      </div>
    </div>
  )
}
