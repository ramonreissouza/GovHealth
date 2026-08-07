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
        {/* Dizia "GPT-4", que não é o motor (ver lib/llm.ts). Anunciar um modelo que
            não está rodando é o tipo de detalhe que o cliente confere. */}
        <Topbar title="Copiloto IA" subtitle="dados PNCP + TransfereGov" />
        {/* Sem `max-w-3xl` aqui: a coluna de conversas anteriores mora dentro do
            ChatInterface, e o limite de largura da página a espremeria. */}
        <main className="flex-1 overflow-hidden py-6 pr-6 bg-bg">
          <div className="h-full flex flex-col">
            <ChatInterface />
          </div>
        </main>
      </div>
    </div>
  )
}
