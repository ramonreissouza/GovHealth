'use client'
// src/app/radar/page.tsx — Radar de Chat (monitoramento de mensagens de licitações).
// Caixa de entrada única: mensagens capturadas dos processos que a SELEÇÃO AUTOMÁTICA
// escolheu a partir do perfil. Alerta por e-mail/in-app e — REQUISITO 4.2 — deixa
// sempre claro o estado de cada conector (nunca "sem novidades" quando não deu p/ verificar).

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Radar, AlertTriangle, ExternalLink, X, Check, Plus, Loader2, Bell } from 'lucide-react'
import { comProblema } from '@/lib/radar/saude'
import { CONECTORES, conectorDisponivel } from '@/lib/radar/conectores'
import SaudeConectores, { type SaudeItem } from './components/SaudeConectores'

const CATEGORIAS = ['convocacao', 'negociacao', 'proposta_ajustada', 'habilitacao', 'diligencia', 'recurso', 'prazo', 'cnpj']
const PRIO_CLS: Record<string, string> = {
  alta: 'bg-red/15 text-red border border-red/30',
  normal: 'bg-brand-blue/15 text-brand-blue border border-brand-blue/30',
  baixa: 'bg-bg4 text-faint border border-subtle2',
}

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

export default function RadarPage() {
  const [data, setData] = useState<Inbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [soNaoLidas, setSoNaoLidas] = useState(false)
  const [prioAlta, setPrioAlta] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [selected, setSelected] = useState<Mensagem | null>(null)
  const [conectar, setConectar] = useState(false)
  const agoraMs = Date.now()

  const carregar = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (soNaoLidas) p.set('lida', '0')
    if (prioAlta) p.set('prioridade', 'alta')
    if (categoria) p.set('categoria', categoria)
    fetch(`/api/radar/inbox?${p}`)
      .then((r) => r.json())
      .then((d: Inbox) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [soNaoLidas, prioAlta, categoria])

  useEffect(() => { carregar() }, [carregar])

  async function marcarLida(m: Mensagem) {
    await fetch(`/api/radar/mensagens/${m.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'lida' }),
    })
    setData((d) => d ? { ...d, mensagens: d.mensagens.map((x) => x.id === m.id ? { ...x, lida: true } : x), kpis: { ...d.kpis, naoLidas: Math.max(0, d.kpis.naoLidas - (m.lida ? 0 : 1)) } } : d)
  }

  const problemas = data ? comProblema(data.saude, agoraMs) : []

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

          {/* Filtros */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button onClick={() => setSoNaoLidas((v) => !v)} className={clsx('text-[11px] px-2.5 py-1.5 rounded-full border transition-colors', soNaoLidas ? 'bg-accent/15 text-accent border-accent/30' : 'border-subtle2 text-faint hover:text-strong')}>Só não lidas</button>
            <button onClick={() => setPrioAlta((v) => !v)} className={clsx('flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border transition-colors', prioAlta ? 'bg-red/15 text-red border-red/30' : 'border-subtle2 text-faint hover:text-strong')}><AlertTriangle size={12} /> Prioridade alta</button>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none">
              <option value="">Todas categorias</option>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Inbox */}
          {loading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-bg2 border border-subtle rounded-lg animate-pulse" />)}</div>
          ) : !data || data.mensagens.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <Bell size={28} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong mb-1">Nenhuma mensagem capturada ainda</p>
              <p className="text-[12px] text-muted max-w-[460px] mx-auto">
                Assim que houver processos monitorados (selecionados pelo seu perfil) e um conector ativo,
                as mensagens de chat aparecem aqui. Verifique a saúde dos conectores acima.
              </p>
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-b border-subtle">
                      <th className="text-left font-medium px-3 py-2.5 w-[70px]">Prior.</th>
                      <th className="text-left font-medium px-3 py-2.5">Processo</th>
                      <th className="text-left font-medium px-3 py-2.5">Autor</th>
                      <th className="text-left font-medium px-3 py-2.5">Mensagem</th>
                      <th className="text-left font-medium px-3 py-2.5">Categorias</th>
                      <th className="text-right font-medium px-3 py-2.5">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mensagens.map((m) => (
                      <tr key={m.id} onClick={() => setSelected(m)} className={clsx('border-b border-subtle last:border-0 hover:bg-bg3 transition-colors cursor-pointer', !m.lida && 'bg-accent/[0.04]', selected?.id === m.id && 'bg-bg3')}>
                        <td className="px-3 py-2.5"><span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', PRIO_CLS[m.prioridade] ?? PRIO_CLS.normal)}>{m.prioridade}</span></td>
                        <td className="px-3 py-2.5"><span className={clsx('truncate block max-w-[200px]', m.lida ? 'text-muted' : 'text-strong font-medium')}>{m.titulo || m.licitacao_id}</span></td>
                        <td className="px-3 py-2.5 text-muted truncate max-w-[120px]">{m.autor || '—'}</td>
                        <td className="px-3 py-2.5 text-muted truncate max-w-[280px]">{m.texto}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1 flex-wrap">
                            {m.categorias.slice(0, 3).map((c) => <span key={c} className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-bg4 text-faint">{c}</span>)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {m.link_portal && <a href={m.link_portal} target="_blank" rel="noopener noreferrer" title="Abrir no portal" className="text-faint hover:text-accent transition-colors"><ExternalLink size={14} /></a>}
                            <button onClick={() => marcarLida(m)} disabled={m.lida} title={m.lida ? 'Lida' : 'Marcar como lida'} className={clsx('flex items-center gap-1 text-[10px] px-1.5 py-1 rounded-md border transition-colors', m.lida ? 'border-emerald-500/30 text-emerald-400' : 'border-subtle2 text-faint hover:text-strong')}>
                              <Check size={12} /> {m.lida ? 'Lida' : 'Lida'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && (
            <p className="text-[10px] text-faint mt-3">
              Os processos são selecionados automaticamente pelo seu perfil (UFs, categorias, termos e portfólio). Ajuste em Perfil & Preferências.
              A captura de chat depende de um conector ativo — "sem novidades" só é confiável quando o conector está verde acima.
            </p>
          )}
        </main>

        {/* Slide-over: detalhe da mensagem */}
        {selected && (
          <div className="fixed inset-0 z-40" onClick={() => setSelected(null)}>
            <div className="absolute inset-0 bg-black/40" />
            <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-bg2 border-l border-subtle shadow-2xl overflow-y-auto">
              <div className="sticky top-0 bg-bg2 border-b border-subtle px-5 py-4 flex items-start justify-between gap-3">
                <div>
                  <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', PRIO_CLS[selected.prioridade] ?? PRIO_CLS.normal)}>{selected.prioridade}</span>
                  <h2 className="font-heading font-bold text-[15px] text-strong mt-1.5">{selected.titulo || selected.licitacao_id}</h2>
                  <p className="text-[11px] text-muted">{selected.autor || 'Autor N/D'} · CNPJ {selected.cnpj || '—'}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-faint hover:text-strong transition-colors flex-shrink-0"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex gap-1 flex-wrap">{selected.categorias.map((c) => <span key={c} className="text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full bg-bg4 text-muted">{c}</span>)}</div>
                <blockquote className="text-[13px] text-strong bg-bg3 border-l-2 border-accent rounded-r-lg p-3 whitespace-pre-wrap">{selected.texto}</blockquote>
                <div className="text-[11px] text-muted">
                  <div><span className="text-faint">Capturado:</span> {new Date(selected.capturado_em).toLocaleString('pt-BR')}</div>
                  {selected.horario_origem && <div><span className="text-faint">Horário no portal:</span> {new Date(selected.horario_origem).toLocaleString('pt-BR')}</div>}
                </div>
                {selected.anexos?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Anexos</div>
                    {selected.anexos.map((a, i) => <div key={i} className="text-[12px] text-accent">{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.nome}</a> : a.nome}</div>)}
                  </div>
                )}
                <div className="flex gap-2">
                  {selected.link_portal && <a href={selected.link_portal} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong"><ExternalLink size={13} /> Abrir no portal</a>}
                  {!selected.lida && <button onClick={() => { marcarLida(selected); setSelected(null) }} className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold"><Check size={13} /> Marcar lida</button>}
                </div>
              </div>
            </div>
          </div>
        )}

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
            <p className="text-[14px] font-semibold text-strong">Conectado ao gov.br</p>
            <p className="text-[12px] text-muted mt-1">A sessão foi capturada com segurança. O Radar já vai monitorar o chat dos seus processos.</p>
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
                        {!c.disponivel && <span className="text-[8px] font-mono-custom uppercase tracking-wide bg-bg4 text-faint px-1 py-0.5 rounded flex-shrink-0">em breve</span>}
                      </div>
                      <div className="text-[10px] text-muted mt-0.5 leading-snug">{c.descricao}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {conectorDisponivel(conectorId) ? (
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
                <strong>próxima etapa</strong>, quando calibrarmos o login e os seletores dele. Por ora, conecte o{' '}
                <strong>Compras.gov.br</strong> para monitorar em tempo real.
              </div>
            )}

            {erro && <p className="text-[12px] text-red mt-3">{erro}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { pararPoll(); onClose() }} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
              <button onClick={conectar} disabled={!conectorDisponivel(conectorId) || salvando || !cnpj || !login} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
                {salvando && <Loader2 size={13} className="animate-spin" />} Continuar para o gov.br
              </button>
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
