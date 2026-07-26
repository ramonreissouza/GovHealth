'use client'
// src/components/feedback/FeedbackWidget.tsx — "Reporte um problema" / ajuda ao usuário.
// Balãozinho fixo no canto inferior direito (todas as telas logadas). Abre um painel de
// chat com formulário ESTRUTURADO. Ao enviar, grava um issue no backlog (/api/feedback),
// que é a fila do agente de triagem/resolução (Fases 2-3).

import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { clsx } from 'clsx'
import { MessageCircle, X, Send, CheckCircle2, Bug, Lightbulb, HelpCircle, Sparkles, Loader2, Paperclip, Image as ImageIcon, FileText } from 'lucide-react'
import {
  TIPOS, SEVERIDADES, TIPO_LABEL, SEVERIDADE_LABEL,
  ANEXO_ACCEPT, ANEXO_MAX_ARQUIVOS, ANEXO_MAX_BYTES, ANEXO_MAX_TOTAL_BYTES,
  isAnexoMimePermitido, formatBytes,
  type FeedbackTipo, type FeedbackSeveridade,
} from '@/lib/feedback'

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
  const [anexos, setAnexos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const oculto = status !== 'authenticated' || ROTAS_OCULTAS.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  if (oculto) return null

  function reset() {
    setTipo('bug'); setSeveridade('media'); setTitulo(''); setDescricao(''); setAnexos([]); setErro(null); setEnviado(false)
  }

  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null)
    const novos = Array.from(e.target.files ?? [])
    e.target.value = '' // permite re-selecionar o mesmo arquivo depois de remover
    const atuais = [...anexos]
    for (const f of novos) {
      if (atuais.length >= ANEXO_MAX_ARQUIVOS) { setErro(`Máximo de ${ANEXO_MAX_ARQUIVOS} anexos.`); break }
      if (!isAnexoMimePermitido(f.type)) { setErro(`Tipo não suportado: ${f.name}. Use imagem, TXT ou PDF.`); continue }
      if (f.size > ANEXO_MAX_BYTES) { setErro(`"${f.name}" excede ${ANEXO_MAX_BYTES / 1024 / 1024} MB.`); continue }
      if (atuais.some((a) => a.name === f.name && a.size === f.size)) continue // evita duplicar
      atuais.push(f)
    }
    if (atuais.reduce((s, f) => s + f.size, 0) > ANEXO_MAX_TOTAL_BYTES) {
      setErro(`Anexos somam mais que ${ANEXO_MAX_TOTAL_BYTES / 1024 / 1024} MB no total.`); return
    }
    setAnexos(atuais)
  }

  function removerAnexo(idx: number) {
    setErro(null); setAnexos((prev) => prev.filter((_, i) => i !== idx))
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
      let res: Response
      if (anexos.length > 0) {
        // Com anexos → multipart (evita inflar base64 e respeita o limite de corpo da Vercel).
        const fd = new FormData()
        fd.set('tipo', tipo); fd.set('severidade', severidade)
        fd.set('titulo', titulo.trim()); fd.set('descricao', descricao.trim())
        fd.set('contexto', JSON.stringify(contexto))
        for (const f of anexos) fd.append('anexos', f)
        res = await fetch('/api/feedback', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo, severidade, titulo: titulo.trim(), descricao: descricao.trim(), contexto }),
        })
      }
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
          className="fixed bottom-5 right-5 z-[200] flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-gradient-brand text-white shadow-lg shadow-accent/25 hover:brightness-105 transition-all"
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
                  className="px-3 py-1.5 rounded-lg bg-gradient-brand text-white text-[12px] font-semibold hover:brightness-105 transition-all">
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

              {/* Anexos (opcional) */}
              <div>
                <label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Anexos (opcional)</label>
                <div className="flex flex-wrap gap-1.5">
                  {anexos.map((f, idx) => (
                    <div key={`${f.name}-${idx}`} className="flex items-center gap-1.5 bg-bg3 border border-subtle rounded-lg pl-2 pr-1 py-1 text-[11px] text-muted">
                      {f.type.startsWith('image/')
                        ? <ImageIcon size={12} className="text-accent flex-shrink-0" />
                        : <FileText size={12} className="text-accent flex-shrink-0" />}
                      <span className="truncate max-w-[110px]" title={f.name}>{f.name}</span>
                      <span className="text-faint">{formatBytes(f.size)}</span>
                      <button onClick={() => removerAnexo(idx)} aria-label={`Remover ${f.name}`}
                        className="p-0.5 rounded hover:bg-bg4 text-faint hover:text-red transition-colors">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  {anexos.length < ANEXO_MAX_ARQUIVOS && (
                    <label className="flex items-center gap-1 cursor-pointer bg-bg3 border border-dashed border-subtle2 rounded-lg px-2.5 py-1.5 text-[11px] text-muted hover:text-strong hover:border-accent/50 transition-colors">
                      <Paperclip size={12} /> Anexar
                      <input type="file" accept={ANEXO_ACCEPT} multiple className="hidden" onChange={onSelectFiles} />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-faint mt-1">Imagem, TXT ou PDF · até {ANEXO_MAX_ARQUIVOS} arquivos, {ANEXO_MAX_TOTAL_BYTES / 1024 / 1024} MB no total.</p>
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
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-gradient-brand text-white text-[13px] font-semibold hover:brightness-105 transition-all shadow-sm shadow-accent/20 disabled:opacity-60">
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
