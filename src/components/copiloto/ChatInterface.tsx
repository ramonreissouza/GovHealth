'use client'
// src/components/copiloto/ChatInterface.tsx

import { useState, useRef, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Send, Bot, Square } from 'lucide-react'
import { getEmpresa } from '@/lib/empresa'
import { HYDRATED_EVENT } from '@/lib/synced'
import HistoricoConversas, { useHistorico } from '@/components/ia/HistoricoConversas'

const SAUDACAO =
  'Olá! Sou o **GovHealth AI**, seu copiloto de inteligência comercial para saúde pública.\n\n' +
  'A plataforma acompanha **PNCP**, **TransfereGov** e **Portal da Transparência** — os números exatos ficam nas telas de Licitações, Vencedores e Radar de Verba. Aqui eu ajudo a **interpretar e decidir**:\n\n' +
  '• Identificar oportunidades antes do edital\n• Analisar concorrentes por região\n' +
  '• Prever editais baseado em convênios ativos\n• Priorizar sua carteira comercial\n\nO que você quer descobrir?'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
}

// Sugestões derivadas do Setup da Empresa. Eram fixas, e uma delas citava pelo nome
// uma empresa real ("Onde a Siemens Healthineers está dominando…") — que aparecia
// dentro da conta de QUALQUER outro cliente. Agora as perguntas falam do território
// e do produto de quem está logado; sem setup, caem num texto genérico.
const REGIOES: Record<string, string[]> = {
  Norte: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MS', 'MT'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC'],
}

/** "BA, CE e mais 3 estados" / "no Nordeste" / "no Brasil" — como citar o território. */
function rotuloTerritorio(ufs: string[]): string {
  if (ufs.length === 0) return 'no Brasil'
  const regiao = Object.entries(REGIOES).find(([, lista]) => ufs.every((u) => lista.includes(u)))
  if (regiao && ufs.length >= 3) return `no ${regiao[0]}`
  if (ufs.length <= 3) return `em ${ufs.join(', ')}`
  return `em ${ufs.slice(0, 3).join(', ')} e mais ${ufs.length - 3}`
}

function montarSugestoes(): string[] {
  const e = getEmpresa()
  const onde = rotuloTerritorio(e.ufs)
  const produto = e.produtos.find((p) => p.ativo)?.nome ?? e.termosBusca[0] ?? ''
  return [
    `Quais municípios ${onde} têm maior chance de abrir edital ${produto ? `para ${produto}` : 'de saúde'} nos próximos 90 dias?`,
    `Quem são meus maiores concorrentes ${onde} e onde eles estão ganhando?`,
    `Quais hospitais receberam emendas parlamentares recentemente e ainda não licitaram?`,
    'Mostre oportunidades com score acima de 80 e baixa concorrência',
    produto
      ? `Qual é o preço médio de contratos de ${produto} nos últimos 12 meses?`
      : 'Qual é o preço médio praticado nos contratos do meu segmento?',
  ]
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'init', role: 'assistant', content: SAUDACAO, createdAt: new Date() },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Histórico: a conversa vive na CONTA. `conversaId` null = ainda não salva (a tela
  // abriu no "Olá!" e ninguém perguntou nada). A saudação NÃO é gravada — é texto
  // fixo da tela, não conteúdo do usuário; salvá-la encheria o histórico de conversas
  // idênticas e vazias.
  const [conversaId, setConversaId] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const { conversas, recarregar } = useHistorico('copiloto')

  // Uma "sessão de tela": muda quando o usuário abre outra conversa ou clica em Nova
  // conversa. Tudo que é assíncrono (carregar o histórico, o streaming da resposta,
  // a gravação) confere a sessão antes de escrever na tela.
  //
  // Sem isso a tela mentia: quem clicava numa conversa e, antes de ela chegar,
  // pedia "Nova conversa" e já perguntava outra coisa, via a pergunta SUMIR — a
  // resposta atrasada do clique anterior chegava depois e repunha a conversa velha
  // por cima. Pior: a resposta nova ia parar, gravada, dentro da conversa antiga.
  const sessaoRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  /** Encerra o que estiver em voo e abre uma sessão nova. Devolve o número dela. */
  const trocarSessao = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)   // senão um pedido pendurado deixaria o campo desabilitado para sempre
    return ++sessaoRef.current
  }, [])

  const novaConversa = useCallback(() => {
    trocarSessao()
    setAbrindo(false)
    setConversaId(null)
    setMessages([{ id: 'init', role: 'assistant', content: SAUDACAO, createdAt: new Date() }])
    setInput('')
    inputRef.current?.focus()
  }, [trocarSessao])

  const abrirConversa = useCallback(async (id: string) => {
    const seq = trocarSessao()
    setConversaId(id)   // marca a ativa na lista já no clique, sem esperar a rede
    setAbrindo(true)
    try {
      const r = await fetch(`/api/ia/conversas/${id}`)
      if (seq !== sessaoRef.current) return   // o usuário já saiu daqui
      if (!r.ok) return
      const j = await r.json()
      if (seq !== sessaoRef.current) return
      setMessages((j.mensagens ?? []).map((m: { id: number; papel: string; conteudo: string; criado_em: string }) => ({
        id: String(m.id),
        role: m.papel === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.conteudo,
        createdAt: new Date(m.criado_em),
      })))
    } catch { /* deixa a conversa atual na tela */ }
    finally { if (seq === sessaoRef.current) setAbrindo(false) }
  }, [trocarSessao])

  /**
   * Grava o par pergunta+resposta. Cria a conversa no primeiro par.
   * `id` vem por parâmetro (e não do estado) porque quem chama é o `finally` de um
   * envio que começou lá atrás: ler o estado aqui gravaria na conversa que estiver
   * aberta AGORA, não naquela em que a pergunta foi feita.
   */
  const persistir = useCallback(async (id: string | null, seq: number, pergunta: string, resposta: string) => {
    const mensagens = [
      { papel: 'user', conteudo: pergunta },
      { papel: 'assistant', conteudo: resposta },
    ]
    try {
      if (id) {
        await fetch(`/api/ia/conversas/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mensagens }),
        })
      } else {
        const r = await fetch('/api/ia/conversas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo: 'copiloto', mensagens }),
        })
        const j = await r.json()
        // Só assume o id novo se a tela ainda está nessa conversa — senão o próximo
        // envio, já em outra conversa, escreveria dentro desta.
        if (j?.id && seq === sessaoRef.current) setConversaId(j.id)
      }
      await recarregar()
    } catch { /* a conversa segue na tela mesmo se o histórico falhar */ }
  }, [recarregar])

  // Setup só existe no cliente (localStorage) e chega assíncrono logo após o login.
  const [sugestoes, setSugestoes] = useState<string[]>([])
  useEffect(() => {
    const montar = () => setSugestoes(montarSugestoes())
    montar()
    window.addEventListener(HYDRATED_EVENT, montar)
    return () => window.removeEventListener(HYDRATED_EVENT, montar)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string = input) {
    if (!text.trim() || loading || abrindo) return

    // Congelados no início: a conversa em que a pergunta foi feita e a sessão de
    // tela dela. Todo o resto desta função é assíncrono e o estado pode mudar no meio.
    const seq = sessaoRef.current
    const idDestino = conversaId

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

    // Teto de espera: o provedor é o plano grátis da Z.ai e já pendurou requisição.
    // Sem isso o `loading` nunca cai e o campo de digitar fica morto até dar F5.
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const limite = setTimeout(() => ctrl.abort(new DOMException('tempo', 'TimeoutError')), 90_000)

    // Fora do try porque o `finally` precisa ler o texto acumulado para gravar.
    let accumulated = ''
    try {
      const res = await fetch('/api/copiloto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
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

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (seq !== sessaoRef.current) return   // trocou de conversa no meio do stream

        const text = decoder.decode(value)
        const lines = text.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)
            // O texto de cada passo é copiado para um const ANTES de entrar no
            // updater do setMessages. Antes o closure capturava `accumulated`, que
            // continua sendo mutado no laço — o React (e a regra de imutabilidade do
            // compilador) trata variável capturada como congelada, e ler um valor que
            // muda depois é justamente a receita de render com texto errado.
            if (parsed.delta) {
              accumulated += parsed.delta
              const conteudo = accumulated
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: conteudo } : m
                )
              )
            }
            if (parsed.error) {
              accumulated = `Erro: ${parsed.error}`
              const conteudo = accumulated
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: conteudo } : m
                )
              )
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err) {
      // Cancelado pelo próprio usuário (Parar, Nova conversa, abrir outra): a tela já
      // está onde ele quer, não há erro a mostrar.
      const abortado = err instanceof DOMException && err.name === 'AbortError'
      if (seq !== sessaoRef.current) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: abortado && !accumulated
                  ? '_Resposta interrompida._'
                  : abortado
                    ? accumulated
                    : 'Erro ao conectar com o copiloto. Tente de novo em alguns instantes.',
              }
            : m
        )
      )
    } finally {
      clearTimeout(limite)
      if (abortRef.current === ctrl) abortRef.current = null
      if (seq === sessaoRef.current) {
        setLoading(false)
        inputRef.current?.focus()
        // Só grava se a resposta veio. Salvar um turno com resposta vazia deixaria no
        // histórico uma conversa que não dá para retomar.
        if (accumulated.trim()) void persistir(idDestino, seq, userMsg.content, accumulated)
      }
    }
  }

  /** Para a resposta em andamento SEM trocar de sessão: o que já veio fica na tela e é gravado. */
  function pararResposta() {
    abortRef.current?.abort()
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
    <div className="flex h-full overflow-hidden">
      <HistoricoConversas
        tipo="copiloto"
        conversas={conversas}
        ativaId={conversaId}
        onAbrir={abrirConversa}
        onNova={novaConversa}
        // Apagar a conversa ABERTA tem de limpar a tela também — senão ela continua
        // ali, parecendo salva, e a próxima pergunta ressuscitaria um id que já não existe.
        onApagada={() => { void recarregar(); novaConversa() }}
      />
      <div className="flex-1 flex flex-col h-full min-w-0 pl-5">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {/* Abrir uma conversa é uma ida ao banco. Sem este aviso a tela ficava com a
            conversa anterior no lugar, dando a impressão de que o clique não pegou. */}
        {abrindo && (
          <div className="text-[11px] font-mono-custom text-faint px-1">carregando conversa…</div>
        )}
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
            {sugestoes.map((s) => (
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
          disabled={loading || abrindo}
          className="flex-1 bg-bg3 border border-subtle2 rounded-lg px-4 py-2.5 text-[13px] text-strong placeholder:text-faint resize-none outline-none focus:border-accent/40 transition-colors disabled:opacity-50"
        />
        {/* Enquanto responde, o botão vira "parar": o campo fica desabilitado durante o
            streaming, então sem uma saída um pedido lento prendia a tela. */}
        {loading ? (
          <button
            onClick={pararResposta}
            title="Parar resposta"
            className="px-4 py-2.5 bg-bg3 border border-subtle2 hover:border-accent/40 text-muted rounded-lg transition-colors flex items-center gap-2"
          >
            <Square size={13} />
          </button>
        ) : (
          <button
            onClick={() => sendMessage()}
            disabled={abrindo || !input.trim()}
            className="px-4 py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-black rounded-lg transition-colors flex items-center gap-2"
          >
            <Send size={14} />
          </button>
        )}
      </div>
      </div>
    </div>
  )
}
