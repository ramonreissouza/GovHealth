'use client'
// src/components/copiloto/ChatInterface.tsx

import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { Send, Bot } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
}

const SUGGESTIONS = [
  'Quais municípios do Nordeste têm maior chance de abrir edital para tomografia nos próximos 90 dias?',
  'Onde a Siemens Healthineers está dominando e como posso competir?',
  'Quais hospitais receberam emendas parlamentares recentemente e ainda não licitaram?',
  'Mostre oportunidades com score acima de 80 e baixa concorrência',
  'Qual é o preço médio de contratos de ultrassom nos últimos 12 meses?',
]

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init',
      role: 'assistant',
      content:
        'Olá! Sou o **GovHealth AI**, seu copiloto de inteligência comercial para saúde pública.\n\nTenho acesso em tempo real a dados do **PNCP**, **TransfereGov** e **Portal da Transparência**. Posso ajudar você a:\n\n• Identificar oportunidades antes do edital\n• Analisar concorrentes por região\n• Prever editais baseado em convênios ativos\n• Priorizar sua carteira comercial\n\nO que você quer descobrir?',
      createdAt: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string = input) {
    if (!text.trim() || loading) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      createdAt: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', createdAt: new Date() },
    ])

    try {
      const res = await fetch('/api/copiloto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        const lines = text.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)
            if (parsed.delta) {
              accumulated += parsed.delta
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulated } : m
                )
              )
            }
            if (parsed.error) {
              accumulated = `Erro: ${parsed.error}`
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulated } : m
                )
              )
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  'Erro ao conectar com o copiloto. Verifique se OPENAI_API_KEY está configurada no .env.local.',
              }
            : m
        )
      )
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function formatContent(content: string) {
    // Simple markdown-ish rendering
    return content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
      .replace(/^• /gm, '&bull; ')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">
                <Bot size={13} className="text-accent" />
              </div>
            )}
            <div
              className={clsx(
                'max-w-[85%] rounded-xl px-4 py-3 text-[13px] leading-relaxed',
                msg.role === 'user'
                  ? 'bg-accent text-black font-medium rounded-br-sm'
                  : 'bg-bg3 border border-subtle text-strong rounded-bl-sm'
              )}
            >
              {msg.role === 'assistant' && messages.indexOf(msg) === 0 && (
                <div className="text-[10px] text-accent font-mono-custom mb-2 tracking-wide">
                  GovHealth IA · online
                </div>
              )}
              {msg.content ? (
                <span dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
              ) : (
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Suggestions — só mostra na mensagem inicial */}
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 pl-9">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="text-[11px] px-3 py-1.5 rounded-full border border-subtle2 text-muted hover:text-strong hover:bg-bg3 transition-all"
              >
                {s.length > 50 ? s.substring(0, 50) + '…' : s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-subtle pt-4 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte sobre municípios, editais, concorrentes, verbas..."
          rows={1}
          disabled={loading}
          className="flex-1 bg-bg3 border border-subtle2 rounded-lg px-4 py-2.5 text-[13px] text-strong placeholder:text-faint resize-none outline-none focus:border-accent/40 transition-colors disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-black rounded-lg transition-colors flex items-center gap-2"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
