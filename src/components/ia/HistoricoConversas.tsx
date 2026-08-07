'use client'
// src/components/ia/HistoricoConversas.tsx — coluna de conversas anteriores.
// Usada pelo Copiloto IA e pelo Copiloto de Edital: a diferença entre os dois é só
// o `tipo`, e o que conta como "conversa" no Edital é uma análise salva.

import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { MessageSquarePlus, Trash2, History } from 'lucide-react'

export interface ConversaResumo {
  id: string
  titulo: string
  atualizado_em: string
  n: number
}

/** "agora", "há 3 h", "ontem", "12/07" — o suficiente para reconhecer a conversa. */
function quando(iso: string): string {
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  if (h < 48) return 'ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function useHistorico(tipo: 'copiloto' | 'edital') {
  const [conversas, setConversas] = useState<ConversaResumo[]>([])
  const recarregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/ia/conversas?tipo=${tipo}`)
      const j = await r.json()
      setConversas(j.conversas ?? [])
    } catch { /* offline: mantém a lista atual */ }
  }, [tipo])
  useEffect(() => { void recarregar() }, [recarregar])
  return { conversas, recarregar }
}

export default function HistoricoConversas({
  tipo, conversas, ativaId, onAbrir, onNova, onApagada, rotuloNovo = 'Nova conversa', vazio,
}: {
  tipo: 'copiloto' | 'edital'
  conversas: ConversaResumo[]
  ativaId: string | null
  onAbrir: (id: string) => void
  onNova: () => void
  onApagada: () => void
  rotuloNovo?: string
  vazio?: string
}) {
  const [apagando, setApagando] = useState<string | null>(null)

  async function apagar(id: string, e: React.MouseEvent) {
    e.stopPropagation()          // não abrir a conversa que está sendo apagada
    setApagando(id)
    try {
      await fetch(`/api/ia/conversas/${id}`, { method: 'DELETE' })
      onApagada()
    } finally { setApagando(null) }
  }

  return (
    <aside className="w-[248px] flex-shrink-0 border-r border-subtle bg-bg2/40 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-subtle">
        <button
          onClick={onNova}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent text-black font-mono-custom font-bold text-[11px] rounded-lg hover:bg-accent/90 transition-colors"
        >
          <MessageSquarePlus size={13} /> {rotuloNovo}
        </button>
      </div>

      <div className="px-3 pt-3 pb-1 flex items-center gap-1.5">
        <History size={11} className="text-faint" />
        <span className="text-[9px] font-mono-custom text-faint uppercase tracking-wider">Conversas anteriores</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {conversas.length === 0 ? (
          <p className="text-[11px] text-faint px-2 py-3 leading-snug">
            {vazio ?? 'Suas conversas ficam salvas aqui e você pode voltar nelas depois.'}
          </p>
        ) : conversas.map((c) => (
          <div
            key={c.id}
            onClick={() => onAbrir(c.id)}
            className={clsx(
              'group flex items-start gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-colors',
              c.id === ativaId ? 'bg-accent/10 border border-accent/30' : 'hover:bg-bg3 border border-transparent',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className={clsx('text-[12px] leading-snug line-clamp-2', c.id === ativaId ? 'text-strong font-medium' : 'text-muted')}>
                {c.titulo}
              </div>
              <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                {quando(c.atualizado_em)}{tipo === 'copiloto' && c.n > 0 ? ` · ${c.n} msg` : ''}
              </div>
            </div>
            <button
              onClick={(e) => apagar(c.id, e)}
              disabled={apagando === c.id}
              title="Apagar conversa"
              className="opacity-0 group-hover:opacity-100 text-faint hover:text-brand-red transition-all flex-shrink-0 mt-0.5 disabled:opacity-40"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
