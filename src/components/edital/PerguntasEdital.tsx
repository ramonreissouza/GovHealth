'use client'
// src/components/edital/PerguntasEdital.tsx — perguntas livres sobre o edital carregado.
//
// A análise estruturada responde o que NÓS decidimos perguntar. Isto aqui é para o
// resto: "posso participar sem registro na ANVISA?", "qual o prazo de entrega?",
// "cabe impugnação no item 7?". A fonte é o mesmo texto que já está na tela.

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Send, Square, MessagesSquare, X } from 'lucide-react'

export interface TurnoEdital {
  id: string
  role: 'user' | 'assistant'
  content: string
}

/** Perguntas de partida: as dúvidas que aparecem em toda mesa de licitação. */
const SUGESTOES = [
  'Quais documentos de habilitação eu preciso ter em dia?',
  'Qual o prazo de entrega e o local?',
  'Existe exigência que restringe a competição?',
  'Ainda dá tempo de impugnar?',
  'O que pode me inabilitar nesse edital?',
]

function formatar(s: string): string {
  return s
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c])
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

export default function PerguntasEdital({
  texto, portfolio, turnos, setTurnos, onPergunta, onResposta, truncado, pedidoFoco = 0, onFechar,
}: {
  texto: string
  portfolio: string[]
  turnos: TurnoEdital[]
  setTurnos: React.Dispatch<React.SetStateAction<TurnoEdital[]>>
  /** Chamado no ENVIO da pergunta. Separado da resposta de propósito: gravar só o par
   *  completo perdia a pergunta quando o usuário saía da tela enquanto a IA escrevia. */
  onPergunta?: (pergunta: string) => void
  /** Chamado quando a resposta fecha — grava no histórico da conta. */
  onResposta?: (pergunta: string, resposta: string) => void
  /** O texto disponível é só um trecho (análise antiga, salva antes de guardarmos o edital inteiro). */
  truncado?: boolean
  /** Contador que sobe a cada clique em "Tirar dúvidas" — traz o painel à vista e foca o campo. */
  pedidoFoco?: number
  onFechar?: () => void
}) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const caixaRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turnos])
  // Encerra o pedido em voo se a tela sair (trocar de análise, sair da página).
  useEffect(() => () => abortRef.current?.abort(), [])
  // O botão fica no alto e o painel embaixo da análise, que é longa: sem rolar até
  // aqui o clique pareceria não ter feito nada.
  useEffect(() => {
    if (!pedidoFoco) return
    caixaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    inputRef.current?.focus({ preventScroll: true })
  }, [pedidoFoco])

  async function perguntar(q: string = input) {
    const pergunta = q.trim()
    if (!pergunta || loading) return

    const idResposta = crypto.randomUUID()
    setTurnos((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: pergunta },
      { id: idResposta, role: 'assistant', content: '' },
    ])
    setInput('')
    setLoading(true)
    onPergunta?.(pergunta)

    // O histórico vai SEM o turno novo (que ainda não tem resposta) — e sem o texto
    // do edital, que o servidor põe no prompt do sistema.
    const historico = turnos.filter((t) => t.content).map((t) => ({ role: t.role, content: t.content }))

    const ctrl = new AbortController()
    abortRef.current = ctrl
    const limite = setTimeout(() => ctrl.abort(), 90_000)

    let acumulado = ''
    try {
      const res = await fetch('/api/edital/pergunta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ texto, pergunta, historico, portfolio }),
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? 'Falha na consulta')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const linha of decoder.decode(value).split('\n')) {
          if (!linha.startsWith('data: ')) continue
          const dado = linha.slice(6)
          if (dado === '[DONE]') break
          try {
            const p = JSON.parse(dado)
            if (p.delta) {
              acumulado += p.delta
              const conteudo = acumulado
              setTurnos((prev) => prev.map((t) => (t.id === idResposta ? { ...t, content: conteudo } : t)))
            }
            if (p.error) {
              acumulado = `Erro: ${p.error}`
              const conteudo = acumulado
              setTurnos((prev) => prev.map((t) => (t.id === idResposta ? { ...t, content: conteudo } : t)))
            }
          } catch { /* chunk partido no meio: o próximo fecha */ }
        }
      }
    } catch (e) {
      const abortado = e instanceof DOMException && e.name === 'AbortError'
      if (!abortado) {
        setTurnos((prev) => prev.map((t) => (t.id === idResposta
          ? { ...t, content: 'Não consegui consultar o edital agora. Tente de novo em alguns instantes.' }
          : t)))
      } else if (!acumulado) {
        setTurnos((prev) => prev.filter((t) => t.id !== idResposta))
      }
    } finally {
      clearTimeout(limite)
      if (abortRef.current === ctrl) abortRef.current = null
      setLoading(false)
      inputRef.current?.focus()
      if (acumulado.trim()) onResposta?.(pergunta, acumulado)
    }
  }

  return (
    <div ref={caixaRef} className="borda-purple bg-bg2 border rounded-xl p-4 mt-4 scroll-mt-6">
      <div className="flex items-center gap-2 mb-1">
        <MessagesSquare size={14} className="text-brand-purple" />
        <h3 className="font-heading font-bold text-[13px] text-strong">Tirar dúvidas sobre este edital</h3>
        {onFechar && (
          <button
            onClick={onFechar}
            title="Fechar (as perguntas ficam salvas)"
            className="ml-auto text-faint hover:text-strong transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-faint mb-3">
        Responde só com base no documento carregado — e avisa quando a resposta não está lá.
        As perguntas ficam salvas junto com a análise, em &ldquo;Conversas anteriores&rdquo;.
        {truncado && ' Atenção: desta análise só ficou salvo um trecho do edital; reenvie o PDF para perguntar sobre o texto completo.'}
      </p>

      {turnos.length > 0 && (
        <div className="space-y-3 mb-3 max-h-[420px] overflow-y-auto pr-1">
          {turnos.map((t) => (
            <div key={t.id} className={clsx('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={clsx(
                  'max-w-[88%] rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed',
                  t.role === 'user'
                    ? 'bg-accent text-black font-medium rounded-br-sm'
                    : 'bg-bg3 border border-subtle text-strong rounded-bl-sm',
                )}
              >
                {t.content
                  ? <span dangerouslySetInnerHTML={{ __html: formatar(t.content) }} />
                  : (
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  )}
              </div>
            </div>
          ))}
          <div ref={fimRef} />
        </div>
      )}

      {turnos.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              onClick={() => perguntar(s)}
              className="text-[11px] px-3 py-1.5 rounded-full border border-subtle2 text-muted hover:text-strong hover:bg-bg3 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void perguntar() }
          }}
          placeholder="Pergunte qualquer coisa sobre este edital…"
          rows={1}
          disabled={loading}
          className="flex-1 bg-bg3 border border-subtle2 rounded-lg px-3.5 py-2.5 text-[12.5px] text-strong placeholder:text-faint resize-none outline-none focus:border-accent/40 transition-colors disabled:opacity-50"
        />
        {loading ? (
          <button
            onClick={() => abortRef.current?.abort()}
            title="Parar resposta"
            className="px-4 py-2.5 bg-bg3 border border-subtle2 hover:border-accent/40 text-muted rounded-lg transition-colors"
          >
            <Square size={13} />
          </button>
        ) : (
          <button
            onClick={() => perguntar()}
            disabled={!input.trim()}
            className="px-4 py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-black rounded-lg transition-colors"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
