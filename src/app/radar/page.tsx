'use client'
// src/app/radar/page.tsx — Radar de Chat (monitoramento de mensagens de licitações).
// Caixa de entrada única: mensagens capturadas dos processos que a SELEÇÃO AUTOMÁTICA
// escolheu a partir do perfil. Alerta por e-mail/in-app e — REQUISITO 4.2 — deixa
// sempre claro o estado de cada conector (nunca "sem novidades" quando não deu p/ verificar).

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Radar, AlertTriangle, ExternalLink, X, Check, Plus, Loader2, Bell,
  Search, Star, Archive, ArchiveRestore, CheckCheck, MessageSquare, Paperclip, Inbox as InboxIcon,
} from 'lucide-react'
import { comProblema } from '@/lib/radar/saude'
import { CONECTORES, conectorDisponivel, conectorPublico } from '@/lib/radar/conectores'
import SaudeConectores, { type SaudeItem } from './components/SaudeConectores'

const CATEGORIAS = ['convocacao', 'negociacao', 'proposta_ajustada', 'habilitacao', 'diligencia', 'recurso', 'prazo', 'cnpj']

interface Mensagem {
  id: number; processo_id: string; conector_id: string; cnpj: string; licitacao_id: string
  autor: string | null; texto: string; anexos: { nome: string; url?: string }[]
  horario_origem: string | null; capturado_em: string; categorias: string[]; prioridade: string
  lida: boolean; titulo: string | null; link_portal: string | null
}
interface Inbox {
  mensagens: Mensagem[]
  kpis: { naoLidas: number; processosAtivos: number; conectores: number }
  saude: SaudeItem[]
  atualizadoEm: string
}

// ── Agrupamento por PROCESSO (benchmark ConLicitação "Monitorar Chat") ─────────
// A caixa deixa de ser uma lista solta de mensagens e vira uma CONVERSA por
// processo: à esquerda os processos monitorados; à direita a thread do chat.
interface Processo {
  id: string
  titulo: string
  conectorId: string
  cnpj: string
  licitacaoId: string
  linkPortal: string | null
  mensagens: Mensagem[]   // ordem cronológica (mais antiga → mais recente)
  naoLidas: number
  ultima: Mensagem
  prioridadeAlta: boolean
}

function agruparProcessos(mensagens: Mensagem[]): Processo[] {
  const mapa = new Map<string, Mensagem[]>()
  for (const m of mensagens) {
    const chave = m.processo_id || m.licitacao_id || String(m.id)
    ;(mapa.get(chave) ?? mapa.set(chave, []).get(chave)!).push(m)
  }
  const procs: Processo[] = []
  for (const [id, msgs] of mapa) {
    const ordenadas = [...msgs].sort((a, b) => tempoMs(a) - tempoMs(b))
    const ultima = ordenadas[ordenadas.length - 1]
    procs.push({
      id,
      titulo: ultima.titulo || ultima.licitacao_id || 'Processo',
      conectorId: ultima.conector_id,
      cnpj: ultima.cnpj,
      licitacaoId: ultima.licitacao_id,
      linkPortal: ultima.link_portal,
      mensagens: ordenadas,
      naoLidas: ordenadas.filter((m) => !m.lida).length,
      ultima,
      prioridadeAlta: ordenadas.some((m) => m.prioridade === 'alta' && !m.lida),
    })
  }
  // Mais recente primeiro; não lidos sobem.
  return procs.sort((a, b) => (b.naoLidas > 0 ? 1 : 0) - (a.naoLidas > 0 ? 1 : 0) || tempoMs(b.ultima) - tempoMs(a.ultima))
}

function tempoMs(m: Mensagem): number {
  const d = m.horario_origem || m.capturado_em
  const t = d ? new Date(d).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

function horaCurta(m: Mensagem): string {
  const d = m.horario_origem || m.capturado_em
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const PORTAL_LABEL: Record<string, string> = {
  comprasgov: 'Compras.gov', comprasnet: 'Comprasnet', 'licitacoes-e': 'Licitações-e',
  bll: 'BLL', bnc: 'BNC', pcp: 'PCP', portal_compras_publicas: 'PCP',
}
const portalLabel = (id: string) => PORTAL_LABEL[id] ?? (id ? id.toUpperCase() : 'Portal')

// Papel do autor (Pregoeiro × Fornecedor × Participante) para estilizar a thread.
function papelAutor(autor: string | null): 'pregoeiro' | 'fornecedor' | 'sistema' | 'outro' {
  const a = (autor ?? '').toLowerCase()
  if (/preg|agente|comiss|autoridade/.test(a)) return 'pregoeiro'
  if (/fornec|licitante|empresa|particip/.test(a)) return 'fornecedor'
  if (/sistema|system/.test(a)) return 'sistema'
  return 'outro'
}
const PAPEL_CLS: Record<string, string> = {
  pregoeiro: 'text-brand-blue',
  fornecedor: 'text-accent',
  sistema: 'text-faint',
  outro: 'text-muted',
}

// Flags locais por processo (Importante / Arquivado) — v1 client-side; a captura
// vem de um worker, então marcações do usuário ficam no navegador (localStorage).
type Flags = Record<string, { importante?: boolean; arquivado?: boolean }>
const FLAGS_KEY = 'radar_flags_v1'
function lerFlags(): Flags { try { return JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}') } catch { return {} } }
function salvarFlags(f: Flags) { try { localStorage.setItem(FLAGS_KEY, JSON.stringify(f)) } catch { /* quota */ } }

type Aba = 'todas' | 'nao_lidas' | 'importantes' | 'arquivados'

export default function RadarPage() {
  const [data, setData] = useState<Inbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>('todas')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [selId, setSelId] = useState<string | null>(null)   // processo selecionado
  const [conectar, setConectar] = useState(false)
  const [flags, setFlags] = useState<Flags>({})
  const agoraMs = Date.now()

  useEffect(() => { setFlags(lerFlags()) }, [])

  const carregar = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (categoria) p.set('categoria', categoria)
    fetch(`/api/radar/inbox?${p}`)
      .then((r) => r.json())
      .then((d: Inbox) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [categoria])

  useEffect(() => { carregar() }, [carregar])

  // Marca UMA mensagem lida (otimista) — usada ao abrir a thread do processo.
  const marcarLidaMsg = useCallback(async (m: Mensagem) => {
    if (m.lida) return
    setData((d) => d ? {
      ...d,
      mensagens: d.mensagens.map((x) => x.id === m.id ? { ...x, lida: true } : x),
      kpis: { ...d.kpis, naoLidas: Math.max(0, d.kpis.naoLidas - 1) },
    } : d)
    try {
      await fetch(`/api/radar/mensagens/${m.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'lida' }),
      })
    } catch { /* melhor esforço; recarrega depois reconcilia */ }
  }, [])

  const setFlag = (id: string, patch: { importante?: boolean; arquivado?: boolean }) => {
    setFlags((f) => {
      const novo = { ...f, [id]: { ...f[id], ...patch } }
      salvarFlags(novo)
      return novo
    })
  }

  const problemas = data ? comProblema(data.saude, agoraMs) : []

  // Agrupa em processos e aplica aba/busca/categoria.
  const processos = useMemo(() => agruparProcessos(data?.mensagens ?? []), [data])
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return processos.filter((p) => {
      const arq = !!flags[p.id]?.arquivado
      const imp = !!flags[p.id]?.importante
      if (aba === 'arquivados') { if (!arq) return false } else if (arq) return false
      if (aba === 'nao_lidas' && p.naoLidas === 0) return false
      if (aba === 'importantes' && !imp) return false
      if (categoria && !p.mensagens.some((m) => m.categorias.includes(categoria))) return false
      if (q) {
        const alvo = `${p.titulo} ${p.licitacaoId} ${p.cnpj} ${p.mensagens.map((m) => m.texto).join(' ')}`.toLowerCase()
        if (!alvo.includes(q)) return false
      }
      return true
    })
  }, [processos, flags, aba, categoria, busca])

  const contagem = useMemo(() => {
    const ativos = processos.filter((p) => !flags[p.id]?.arquivado)
    return {
      todas: ativos.length,
      nao_lidas: ativos.filter((p) => p.naoLidas > 0).length,
      importantes: ativos.filter((p) => flags[p.id]?.importante).length,
      arquivados: processos.filter((p) => flags[p.id]?.arquivado).length,
    }
  }, [processos, flags])

  const selecionado = filtrados.find((p) => p.id === selId) ?? null

  // Ao abrir um processo, marca suas mensagens não lidas como lidas (estilo e-mail).
  const abrirProcesso = (p: Processo) => {
    setSelId(p.id)
    for (const m of p.mensagens) if (!m.lida) void marcarLidaMsg(m)
  }
  const marcarTodasLidas = (p: Processo) => { for (const m of p.mensagens) if (!m.lida) void marcarLidaMsg(m) }

  const ABAS: { key: Aba; label: string; n: number }[] = [
    { key: 'todas', label: 'Todas', n: contagem.todas },
    { key: 'nao_lidas', label: 'Não lidas', n: contagem.nao_lidas },
    { key: 'importantes', label: 'Importantes', n: contagem.importantes },
    { key: 'arquivados', label: 'Arquivados', n: contagem.arquivados },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Radar de Chat" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Header */}
          <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Radar size={18} className="text-accent" />
                <h1 className="font-heading font-bold text-[20px] text-strong">Radar de Chat</h1>
              </div>
              <p className="text-[12px] text-muted mt-1 max-w-[640px]">
                Monitoramento das mensagens e convocações dos processos que combinam com o
                <strong className="text-strong"> seu perfil</strong> — nada de cadastrar licitação a licitação.
                Convocação, negociação, diligência ou prazo: você é avisado por e-mail e aqui.
              </p>
            </div>
            <button onClick={() => setConectar(true)} className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold hover:bg-accent2 transition-colors">
              <Plus size={14} /> Conectar portal
            </button>
          </div>

          {/* REQUISITO 4.2 — banner de incerteza */}
          {problemas.length > 0 && (
            <div className="mb-4 flex items-start gap-2 bg-amber/10 border border-amber/30 rounded-lg px-4 py-3">
              <AlertTriangle size={16} className="text-amber flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber">
                Não foi possível verificar {problemas.length} conector(es) recentemente — a lista pode estar
                <strong> incompleta</strong>. Reconecte as credenciais para voltar a monitorar com segurança.
              </p>
            </div>
          )}

          {/* KPIs */}
          {data && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Kpi label="Mensagens não lidas" valor={String(data.kpis.naoLidas)} destaque={data.kpis.naoLidas > 0} />
              <Kpi label="Processos ativos" valor={String(data.kpis.processosAtivos)} />
              <Kpi label="Conectores OK" valor={String(data.saude.length - problemas.length)} />
              <Kpi label="Conectores c/ problema" valor={String(problemas.length)} destaque={problemas.length > 0} />
            </div>
          )}

          {/* Saúde dos conectores */}
          <div className="mb-5">
            <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Saúde dos conectores</div>
            <SaudeConectores saude={(data?.saude ?? []) as SaudeItem[]} agoraMs={agoraMs} />
          </div>

          {/* Monitorar Chat — 2 painéis (processos × thread), estilo benchmark */}
          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-bg2 border border-subtle rounded-lg animate-pulse" />)}</div>
          ) : !data || processos.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <Bell size={28} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong mb-1">Nenhuma mensagem capturada ainda</p>
              <p className="text-[12px] text-muted max-w-[460px] mx-auto">
                Assim que houver processos monitorados (selecionados pelo seu perfil) e um conector ativo,
                as mensagens de chat aparecem aqui. Verifique a saúde dos conectores acima.
              </p>
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_1fr] h-[560px]">
              {/* Esquerda — lista de processos monitorados */}
              <div className="border-r border-subtle flex flex-col min-h-0">
                {/* Busca */}
                <div className="p-2.5 border-b border-subtle">
                  <div className="flex items-center gap-2 bg-bg3 border border-subtle rounded-lg px-2.5 py-1.5">
                    <Search size={13} className="text-faint flex-shrink-0" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Edital, nº, CNPJ ou texto…"
                      className="bg-transparent text-[12px] text-strong placeholder:text-faint outline-none w-full" />
                    {busca && <button onClick={() => setBusca('')} className="text-faint hover:text-strong"><X size={12} /></button>}
                  </div>
                </div>
                {/* Abas */}
                <div className="flex items-center gap-1 px-2 py-1.5 border-b border-subtle overflow-x-auto">
                  {ABAS.map((t) => (
                    <button key={t.key} onClick={() => setAba(t.key)}
                      className={clsx('flex items-center gap-1 text-[11px] px-2 py-1 rounded-md whitespace-nowrap transition-colors',
                        aba === t.key ? 'bg-accent/15 text-accent font-semibold' : 'text-faint hover:text-strong hover:bg-bg3')}>
                      {t.label}
                      {t.n > 0 && <span className={clsx('text-[9px] font-mono-custom px-1 rounded-full', aba === t.key ? 'bg-accent/20' : 'bg-bg4')}>{t.n}</span>}
                    </button>
                  ))}
                </div>
                {/* Categorias (mantém o filtro fino) */}
                <div className="px-2.5 py-2 border-b border-subtle">
                  <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full text-[11px] bg-bg3 border border-subtle rounded-md px-2 py-1 text-muted focus:border-accent outline-none">
                    <option value="">Todas as categorias</option>
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {/* Lista */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  {filtrados.length === 0 ? (
                    <div className="p-6 text-center text-[12px] text-faint">
                      <InboxIcon size={22} className="mx-auto mb-2 opacity-60" />
                      Nada nesta aba.
                    </div>
                  ) : filtrados.map((p) => {
                    const ativo = selId === p.id
                    const imp = !!flags[p.id]?.importante
                    return (
                      <button key={p.id} onClick={() => abrirProcesso(p)}
                        className={clsx('w-full text-left px-3 py-2.5 border-b border-subtle/70 transition-colors',
                          ativo ? 'bg-accent/10' : 'hover:bg-bg3', p.naoLidas > 0 && !ativo && 'bg-accent/[0.04]')}>
                        <div className="flex items-center gap-1.5">
                          {p.prioridadeAlta && <span title="Prioridade alta"><AlertTriangle size={11} className="text-red flex-shrink-0" /></span>}
                          {imp && <Star size={11} className="text-amber fill-amber flex-shrink-0" />}
                          <span className={clsx('text-[12px] truncate flex-1', p.naoLidas > 0 ? 'text-strong font-semibold' : 'text-muted')}>{p.titulo}</span>
                          {p.naoLidas > 0 && <span className="text-[9px] font-mono-custom bg-accent text-black font-bold px-1.5 rounded-full flex-shrink-0">{p.naoLidas}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[8.5px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1.5 py-0.5 rounded flex-shrink-0">{portalLabel(p.conectorId)}</span>
                          <span className="text-[10px] text-faint truncate flex-1">{p.ultima.autor || '—'}: {p.ultima.texto}</span>
                        </div>
                        <div className="text-[9px] font-mono-custom text-faint mt-0.5">{horaCurta(p.ultima)}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Direita — thread do processo selecionado */}
              <div className="flex flex-col min-h-0">
                {!selecionado ? (
                  <div className="flex-1 flex items-center justify-center text-center p-8">
                    <div>
                      <MessageSquare size={26} className="text-faint mx-auto mb-2 opacity-60" />
                      <p className="text-[13px] text-muted">Selecione um processo à esquerda</p>
                      <p className="text-[11px] text-faint mt-1">As mensagens do chat (pregoeiro, fornecedores) aparecem aqui.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Cabeçalho da thread */}
                    <div className="px-4 py-3 border-b border-subtle flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="font-heading font-bold text-[14px] text-strong truncate">{selecionado.titulo}</h2>
                          <span className="text-[8.5px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1.5 py-0.5 rounded flex-shrink-0">{portalLabel(selecionado.conectorId)}</span>
                        </div>
                        <p className="text-[11px] text-faint mt-0.5 truncate">Nº {selecionado.licitacaoId || '—'} · CNPJ {selecionado.cnpj || '—'} · {selecionado.mensagens.length} mensagens</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => marcarTodasLidas(selecionado)} disabled={selecionado.naoLidas === 0} title="Marcar todas como lidas"
                          className={clsx('p-1.5 rounded-md transition-colors', selecionado.naoLidas === 0 ? 'text-faint/40' : 'text-faint hover:text-emerald-400 hover:bg-bg3')}><CheckCheck size={15} /></button>
                        <button onClick={() => setFlag(selecionado.id, { importante: !flags[selecionado.id]?.importante })} title="Importante"
                          className={clsx('p-1.5 rounded-md transition-colors hover:bg-bg3', flags[selecionado.id]?.importante ? 'text-amber' : 'text-faint hover:text-amber')}>
                          <Star size={15} className={flags[selecionado.id]?.importante ? 'fill-amber' : ''} /></button>
                        <button onClick={() => { const arq = !flags[selecionado.id]?.arquivado; setFlag(selecionado.id, { arquivado: arq }); if (arq) setSelId(null) }} title={flags[selecionado.id]?.arquivado ? 'Desarquivar' : 'Arquivar'}
                          className="p-1.5 rounded-md text-faint hover:text-strong hover:bg-bg3 transition-colors">
                          {flags[selecionado.id]?.arquivado ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
                        {selecionado.linkPortal && <a href={selecionado.linkPortal} target="_blank" rel="noopener noreferrer" title="Abrir no portal"
                          className="p-1.5 rounded-md text-faint hover:text-accent hover:bg-bg3 transition-colors"><ExternalLink size={15} /></a>}
                      </div>
                    </div>
                    {/* Mensagens */}
                    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3 bg-bg">
                      {selecionado.mensagens.map((m) => {
                        const papel = papelAutor(m.autor)
                        return (
                          <div key={m.id} className={clsx('rounded-lg border p-3', m.prioridade === 'alta' ? 'border-red/30 bg-red/[0.04]' : 'border-subtle bg-bg2')}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className={clsx('text-[11px] font-semibold uppercase tracking-wide', PAPEL_CLS[papel])}>{m.autor || 'Mensagem'}</span>
                              <span className="text-[10px] font-mono-custom text-faint flex-shrink-0">{horaCurta(m)}</span>
                            </div>
                            <p className="text-[12.5px] text-strong whitespace-pre-wrap leading-snug">{m.texto}</p>
                            {(m.categorias.length > 0 || m.anexos?.length > 0) && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                {m.categorias.map((c) => <span key={c} className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-bg4 text-faint">{c}</span>)}
                                {m.anexos?.map((a, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 text-[10px] text-accent">
                                    <Paperclip size={10} />{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.nome}</a> : a.nome}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {data && (
            <p className="text-[10px] text-faint mt-3">
              Os processos são selecionados automaticamente pelo seu perfil (UFs, categorias, termos e portfólio). Ajuste em Perfil & Preferências.
              A captura de chat depende de um conector ativo — "sem novidades" só é confiável quando o conector está verde acima.
              Marcações de <strong>Importante</strong> e <strong>Arquivado</strong> ficam neste navegador.
            </p>
          )}
        </main>

        {conectar && <ConectarModal onClose={() => setConectar(false)} onSaved={() => { setConectar(false); carregar() }} />}
      </div>
    </div>
  )
}

function Kpi({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={clsx('bg-bg2 border rounded-xl p-4', destaque ? 'border-accent/30' : 'border-subtle')}>
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">{label}</div>
      <div className={clsx('font-heading font-bold text-[22px] leading-none', destaque ? 'text-accent' : 'text-strong')}>{valor}</div>
    </div>
  )
}

type Fase = 'form' | 'live' | 'conectando' | 'ok' | 'erro'

function ConectarModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [conectorId, setConectorId] = useState('comprasgov')
  const [cnpj, setCnpj] = useState('')
  const [login, setLogin] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [fase, setFase] = useState<Fase>('form')
  const [demorou, setDemorou] = useState(false)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [capturando, setCapturando] = useState(false)
  // Modo público (PCP): monitora pela página pública, sem login. Campos próprios.
  const [pubObjeto, setPubObjeto] = useState('')
  const [pubUf, setPubUf] = useState('')
  const [pubLink, setPubLink] = useState('')
  const publico = conectorPublico(conectorId)
  const nomeSel = CONECTORES.find((c) => c.id === conectorId)?.nome ?? conectorId
  const credId = useRef<string | null>(null)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)
  const t0 = useRef<number>(0)

  const pararPoll = () => { if (poll.current) { clearInterval(poll.current); poll.current = null } }
  useEffect(() => () => pararPoll(), [])

  async function criarCred(): Promise<string | null> {
    if (credId.current) return credId.current
    const r = await fetch('/api/radar/credenciais', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conectorId, cnpj, login }),
    })
    const j = await r.json()
    if (!r.ok) { setErro(j.instrucoes || j.error || 'Falha ao registrar'); return null }
    credId.current = j.id
    return j.id
  }

  // Abre o gov.br no navegador HOSPEDADO (live view no iframe). Se o hosted não
  // estiver configurado (503), cai no fluxo local (fila + serviço de conexão).
  async function iniciarHosted(id: string): Promise<'live' | 'fallback' | 'erro'> {
    const r = await fetch('/api/radar/conexao', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credencialId: id, acao: 'iniciar' }),
    })
    if (r.status === 503) return 'fallback'
    const j = await r.json()
    if (r.ok && j.embedUrl) { setEmbedUrl(j.embedUrl); return 'live' }
    setErro(j.error || j.detalhe || 'Falha ao abrir o gov.br'); return 'erro'
  }

  async function concluirLogin() {
    if (!credId.current) return
    setCapturando(true); setErro(null)
    try {
      const r = await fetch('/api/radar/conexao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credencialId: credId.current, acao: 'capturar' }),
      })
      const j = await r.json()
      if (j.conexao === 'conectado') { setFase('ok'); setTimeout(onSaved, 1200) }
      else if (j.aviso) setErro('Conclua o login no gov.br dentro da janela antes de confirmar.')
      else setErro(j.error || j.detalhe || 'Não foi possível capturar a sessão.')
    } catch { setErro('Falha de rede') } finally { setCapturando(false) }
  }

  async function cancelarLive() {
    if (credId.current) { void fetch('/api/radar/conexao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credencialId: credId.current, acao: 'cancelar' }) }) }
    setEmbedUrl(null); setFase('form')
  }

  function iniciarPoll() {
    t0.current = Date.now()
    setDemorou(false)
    pararPoll()
    poll.current = setInterval(async () => {
      try {
        const r = await fetch('/api/radar/credenciais')
        const j = await r.json()
        const c = (j.credenciais ?? []).find((x: { id: string }) => x.id === credId.current)
        if (!c) return
        if (c.conexao?.status === 'conectado') { pararPoll(); setFase('ok'); setTimeout(onSaved, 1200) }
        else if (c.conexao?.status === 'erro') { pararPoll(); setErro(c.conexao?.detalhe || 'Não foi possível concluir o login.'); setFase('erro') }
        else if (Date.now() - t0.current > 360_000) {
          // Timeout de segurança: nunca ficar "Abrindo…" para sempre.
          pararPoll(); setErro('Não recebemos a confirmação do login a tempo. Verifique se a janela do gov.br abriu e tente de novo.'); setFase('erro')
        } else if (Date.now() - t0.current > 90_000) setDemorou(true)
      } catch { /* rede: tenta no próximo tick */ }
    }, 2500)
  }

  // PCP público: adiciona o processo (objeto + UF + link opcional). Sem login: o
  // worker resolve a URL pública (ou usa o link colado) e lê o andamento.
  async function adicionarPublico() {
    if (!pubObjeto.trim()) { setErro('Informe o objeto/título da licitação.'); return }
    setSalvando(true); setErro(null)
    try {
      const r = await fetch('/api/radar/processos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conectorId, titulo: pubObjeto.trim(), uf: pubUf.trim(), linkPortal: pubLink.trim() || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error || 'Falha ao adicionar'); return }
      setFase('ok'); setTimeout(onSaved, 1200)
    } catch { setErro('Falha de rede') } finally { setSalvando(false) }
  }

  async function conectar() {
    setSalvando(true); setErro(null)
    try {
      const id = await criarCred()
      if (!id) { setSalvando(false); return }
      // Preferência: navegador HOSPEDADO (login dentro da tela).
      const res = await iniciarHosted(id)
      if (res === 'live') { setFase('live'); setSalvando(false); return }
      if (res === 'erro') { setSalvando(false); return }
      // Fallback (hosted não configurado): fluxo local via serviço de conexão.
      const rc = await fetch(`/api/radar/credenciais/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'conectar' }),
      })
      if (!rc.ok) { const j = await rc.json(); setErro(j.error || 'Falha ao iniciar a conexão'); setSalvando(false); return }
      setFase('conectando'); iniciarPoll()
    } catch { setErro('Falha de rede') } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { pararPoll(); onClose() }}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} className={clsx('relative bg-bg2 border border-subtle rounded-2xl w-full p-6', fase === 'live' ? 'max-w-[820px]' : 'max-w-[440px]')}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-heading font-bold text-[16px] text-strong">Conectar portal</h3><button onClick={() => { pararPoll(); onClose() }} className="text-faint hover:text-strong"><X size={18} /></button></div>

        {fase === 'live' ? (
          <div className="mt-2">
            <p className="text-[12px] text-muted mb-3">
              Faça o login na página oficial do <strong className="text-strong">gov.br</strong> abaixo (CPF, senha, 2FA).
              Ao concluir, clique em <strong className="text-strong">“Já concluí o login”</strong>. A senha é digitada no gov.br — nós guardamos só a sessão cifrada.
            </p>
            <div className="rounded-lg border border-subtle overflow-hidden bg-black/20">
              {embedUrl && (
                <iframe
                  src={embedUrl}
                  title="Login gov.br"
                  className="w-full h-[440px] block"
                  allow="clipboard-read; clipboard-write"
                  sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
                />
              )}
            </div>
            {erro && <p className="text-[12px] text-amber mt-3">{erro}</p>}
            <div className="flex justify-between items-center mt-4">
              <button onClick={cancelarLive} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
              <button onClick={concluirLogin} disabled={capturando} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                {capturando && <Loader2 size={13} className="animate-spin" />} Já concluí o login
              </button>
            </div>
          </div>
        ) : fase === 'ok' ? (
          <div className="mt-4 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3"><Check size={24} className="text-emerald-400" /></div>
            <p className="text-[14px] font-semibold text-strong">{publico ? 'Processo adicionado' : 'Conectado ao gov.br'}</p>
            <p className="text-[12px] text-muted mt-1">{publico
              ? 'Sem login: o Radar vai buscar a página pública do processo e trazer o andamento (convocação, habilitação, recurso, prazo, homologação).'
              : 'A sessão foi capturada com segurança. O Radar já vai monitorar o chat dos seus processos.'}</p>
          </div>
        ) : fase === 'conectando' ? (
          <div className="mt-4 text-center py-4">
            <Loader2 size={28} className="text-accent animate-spin mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-strong">Abrindo o gov.br…</p>
            <p className="text-[12px] text-muted mt-1 max-w-[320px] mx-auto">
              Conclua o login na janela do <strong className="text-strong">gov.br</strong> (CPF, senha, 2FA). Assim que entrar,
              esta tela confirma a conexão automaticamente.
            </p>
            {demorou && <p className="text-[11px] text-amber mt-3">Está demorando — confirme que a janela do gov.br abriu e que o login foi concluído.</p>}
            <button onClick={() => { pararPoll(); setFase('form') }} className="text-[11px] text-faint hover:text-strong mt-4">Cancelar</button>
          </div>
        ) : (
          <>
            {/* Catálogo de portais (fonte: lib/radar/conectores). */}
            <div className="mb-4 mt-1">
              <span className="text-[11px] text-faint">Portal</span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {CONECTORES.map((c) => {
                  const ativo = conectorId === c.id
                  return (
                    <button key={c.id} type="button" onClick={() => setConectorId(c.id)}
                      className={clsx('text-left rounded-lg border px-3 py-2 transition-colors',
                        ativo ? 'border-accent bg-accent/10' : 'border-subtle2 bg-bg3 hover:border-subtle')}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[12px] font-semibold text-strong">{c.nome}</span>
                        {c.modoPublico
                          ? <span className="text-[8px] font-mono-custom uppercase tracking-wide bg-accent/20 text-accent px-1 py-0.5 rounded flex-shrink-0">sem login</span>
                          : !c.disponivel && <span className="text-[8px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1 py-0.5 rounded flex-shrink-0">em breve</span>}
                      </div>
                      <div className="text-[10px] text-muted mt-0.5 leading-snug">{c.descricao}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {publico ? (
              <>
                <p className="text-[12px] text-muted mb-4">
                  O {nomeSel} publica o <strong className="text-strong">andamento de cada processo</strong> numa página pública —
                  monitoramos <strong className="text-strong">sem login</strong>. Informe o objeto e a UF; nós achamos o processo
                  automaticamente. Se não acharmos com segurança, cole o link do processo no portal.
                </p>
                <div className="space-y-3">
                  <Campo label="Objeto / título da licitação" value={pubObjeto} onChange={setPubObjeto} placeholder="ex.: aquisição de medicamentos para a farmácia básica" />
                  <Campo label="UF (opcional, ajuda a achar)" value={pubUf} onChange={(v) => setPubUf(v.toUpperCase().slice(0, 2))} placeholder="ex.: SP" />
                  <Campo label="Link do processo no PCP (opcional — fallback)" value={pubLink} onChange={setPubLink} placeholder="cole aqui se souber a URL exata do processo" />
                </div>
                <p className="text-[11px] text-faint mt-3 leading-snug">
                  A sala <strong>ao vivo</strong> (lances em tempo real) usa a sua própria sessão do portal e entra numa próxima etapa —
                  o andamento público já avisa convocação, habilitação, recurso, prazo e homologação.
                </p>
              </>
            ) : conectorDisponivel(conectorId) ? (
              <>
                <p className="text-[12px] text-muted mb-4">
                  O login é feito na <strong className="text-strong">página oficial do gov.br</strong> — não digitamos nem
                  guardamos a sua senha aqui. Guardamos só a <strong className="text-strong">sessão (cookies) cifrada</strong>,
                  usada para ler o chat dos seus processos. Você pode desconectar quando quiser.
                </p>
                <div className="space-y-3">
                  <Campo label="CNPJ do fornecedor" value={cnpj} onChange={setCnpj} placeholder="00.000.000/0000-00" />
                  <Campo label="CPF ou login gov.br (identificação)" value={login} onChange={setLogin} placeholder="para identificar a conexão — a senha fica no gov.br" />
                </div>
              </>
            ) : (
              <div className="bg-amber/10 border border-amber/30 rounded-lg px-3 py-2.5 text-[12px] text-amber leading-snug">
                Este portal já está no modelo de dados e na seleção por perfil — a captura de chat entra na{' '}
                <strong>próxima etapa</strong>, quando calibrarmos o login e os seletores dele. Por ora, use o{' '}
                <strong>Compras.gov.br</strong> ou o <strong>Portal de Compras Públicas</strong> (sem login).
              </div>
            )}

            {erro && <p className="text-[12px] text-red mt-3">{erro}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { pararPoll(); onClose() }} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
              {publico ? (
                <button onClick={adicionarPublico} disabled={salvando || !pubObjeto.trim()} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                  {salvando && <Loader2 size={13} className="animate-spin" />} Monitorar sem login
                </button>
              ) : (
                <button onClick={conectar} disabled={!conectorDisponivel(conectorId) || salvando || !cnpj || !login} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                  {salvando && <Loader2 size={13} className="animate-spin" />} Continuar para o gov.br
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Campo({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-faint">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none" />
    </label>
  )
}
