'use client'
// src/components/feedback/FeedbackWidget.tsx — "Reporte um problema" / ajuda ao usuário.
// Balãozinho fixo no canto inferior direito (todas as telas logadas). Abre um painel de
// chat com formulário ESTRUTURADO. Ao enviar, grava um issue no backlog (/api/feedback),
// que é a fila do agente de triagem/resolução (Fases 2-3).

import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { clsx } from 'clsx'
import { MessageCircle, X, Send, CheckCircle2, Bug, Lightbulb, HelpCircle, Sparkles, Loader2 } from 'lucide-react'
import { TIPOS, SEVERIDADES, TIPO_LABEL, SEVERIDADE_LABEL, type FeedbackTipo, type FeedbackSeveridade } from '@/lib/feedback'

const TIPO_ICON: Record<FeedbackTipo, React.ElementType> = {
  bug: Bug, sugestao: Lightbulb, duvida: HelpCircle, melhoria: Sparkles,
}

// Não aparece em telas públicas / área admin (que tem seu próprio backlog).
const ROTAS_OCULTAS = ['/login', '/inicio', '/metodologia', '/assinar', '/admin', '/esqueci-senha', '/redefinir-senha', '/aceitar-convite']

export default function FeedbackWidget() {
  const { status } = useSession()
  const pathname = usePathname() || ''
  const [aberto, setAberto] = useState(false)

  const [tipo, setTipo] = useState<FeedbackTipo>('bug')
  const [severidade, setSeveridade] = useState<FeedbackSeveridade>('media')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const oculto = status !== 'authenticated' || ROTAS_OCULTAS.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  if (oculto) return null

  function reset() {
    setTipo('bug'); setSeveridade('media'); setTitulo(''); setDescricao(''); setErro(null); setEnviado(false)
  }

  async function enviar() {
    if (!titulo.trim()) { setErro('Descreva o problema em uma frase (título).'); return }
    setEnviando(true); setErro(null)
    try {
      const contexto = {
        rota: pathname,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
      }
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, severidade, titulo: titulo.trim(), descricao: descricao.trim(), contexto }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Falha ao enviar.')
      setEnviado(true)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      {/* Botão flutuante */}
      {!aberto && (
        <button
          onClick={() => setAberto(true)}
          title="Reporte um problema ou peça ajuda"
          className="fixed bottom-5 right-5 z-[200] flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-accent text-black shadow-lg shadow-black/20 hover:bg-accent/90 transition-all"
        >
          <MessageCircle size={18} />
          <span className="text-[13px] font-semibold">Ajuda</span>
        </button>
      )}

      {/* Painel */}
      {aberto && (
        <div className="fixed bottom-5 right-5 z-[200] w-[360px] max-w-[calc(100vw-2.5rem)] bg-bg2 border border-subtle rounded-2xl shadow-2xl shadow-black/30 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-bg3 border-b border-subtle">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-accent" />
              <span className="text-[13px] font-semibold text-strong">Reporte um problema</span>
            </div>
            <button onClick={() => setAberto(false)} className="p-1 rounded hover:bg-bg4 text-faint hover:text-strong transition-colors">
              <X size={16} />
            </button>
          </div>

          {enviado ? (
            <div className="p-6 flex flex-col items-center text-center gap-2">
              <CheckCircle2 size={34} className="text-emerald-400" />
              <h3 className="text-[14px] font-semibold text-strong">Recebido! Obrigado.</h3>
              <p className="text-[12px] text-muted">
                Seu relato entrou na nossa fila de suporte. Vamos analisar e, quando houver uma solução,
                ela passa por validação antes de ir ao ar.
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={reset}
                  className="px-3 py-1.5 rounded-lg bg-bg3 border border-subtle text-[12px] text-muted hover:text-strong transition-colors">
                  Reportar outro
                </button>
                <button onClick={() => { setAberto(false); reset() }}
                  className="px-3 py-1.5 rounded-lg bg-accent text-black text-[12px] font-semibold hover:bg-accent/90 transition-colors">
                  Fechar
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-3.5 overflow-y-auto max-h-[70vh]">
              {/* Tipo */}
              <div>
                <label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Tipo</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {TIPOS.map((t) => {
                    const Icon = TIPO_ICON[t]
                    const ativo = tipo === t
                    return (
                      <button key={t} onClick={() => setTipo(t)}
                        className={clsx('flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[12px] transition-all',
                          ativo ? 'bg-accent/10 border-accent/40 text-strong' : 'bg-bg3 border-subtle text-muted hover:text-strong')}>
                        <Icon size={13} className={ativo ? 'text-accent' : 'text-faint'} /> {TIPO_LABEL[t]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Título */}
              <div>
                <label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">O que aconteceu? *</label>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex: O filtro de UF não salva ao recarregar"
                  className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Detalhes (passos, o que esperava…)</label>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={4}
                  placeholder="Quanto mais detalhe, mais rápido a gente resolve."
                  className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent resize-none"
                />
              </div>

              {/* Severidade */}
              <div>
                <label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Severidade</label>
                <div className="flex gap-1.5">
                  {SEVERIDADES.map((s) => (
                    <button key={s} onClick={() => setSeveridade(s)}
                      className={clsx('flex-1 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all',
                        severidade === s ? 'bg-accent/10 border-accent/40 text-strong' : 'bg-bg3 border-subtle text-muted hover:text-strong')}>
                      {SEVERIDADE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>

              {erro && <p className="text-[12px] text-red">{erro}</p>}

              <button onClick={enviar} disabled={enviando}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors disabled:opacity-60">
                {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
              <p className="text-[10px] text-faint text-center">Registramos automaticamente a página e seu navegador para ajudar no diagnóstico.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
