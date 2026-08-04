'use client'
// src/app/admin/page.tsx — Área do administrador master (PRD-admin).
// Header próprio (sem a Sidebar do app). 4 tabs: Contas, Dashboard, Acessos, Mapa.
// A proteção real é SERVER-SIDE (middleware + guard nas rotas); aqui é só UI.

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { signOut } from 'next-auth/react'
import { clsx } from 'clsx'
import { Users, LayoutDashboard, ScrollText, Map as MapIcon, LogOut, Plus, X, Ban, CheckCircle2, Trash2, Loader2, Copy, CreditCard, MessageCircle } from 'lucide-react'
import { formatarPreco, planoPorId } from '@/lib/planos'

const AdminMapa = dynamic(() => import('@/components/admin/AdminMapa'), { ssr: false, loading: () => <div className="h-[560px] rounded-xl border border-subtle flex items-center justify-center text-faint text-[13px]">Carregando mapa…</div> })
const AdminAnalytics = dynamic(() => import('@/components/admin/AdminAnalytics'), { ssr: false, loading: () => <div className="py-10 text-center text-faint text-[13px]">Carregando análise…</div> })
const AdminFeedback = dynamic(() => import('@/components/admin/AdminFeedback'), { ssr: false, loading: () => <div className="py-10 text-center text-faint text-[13px]">Carregando backlog…</div> })

type Tab = 'contas' | 'assinaturas' | 'dashboard' | 'acessos' | 'mapa' | 'suporte'

interface Usuario {
  id: string; email: string; nome: string | null; role: string; empresa: string | null; telefone: string | null
  instituicao: string | null; endereco: string | null; cpf: string | null; cnpj: string | null
  plano: string | null; status_assinatura: string | null; expira_em: string | null; suspenso: boolean
  deleted_at: string | null; criado_em: string; ultimo_acesso: string | null
}

const fmtData = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
const fmtDataHora = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('contas')
  return (
    <div className="min-h-screen bg-bg text-strong">
      {/* Header próprio do admin */}
      <header className="border-b border-subtle bg-bg2 sticky top-0 z-20">
        <div className="max-w-[1200px] mx-auto px-5 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo-govhealth.png" alt="GovHealth" width={130} height={59} className="h-6 w-auto" />
            <span className="font-mono-custom text-[11px] font-semibold text-accent border border-accent/30 rounded px-1.5 py-0.5">Admin</span>
          </div>
          <nav className="flex items-center gap-1 ml-4">
            {([['contas', 'Contas', Users], ['assinaturas', 'Assinaturas', CreditCard], ['dashboard', 'Dashboard', LayoutDashboard], ['acessos', 'Acessos', ScrollText], ['suporte', 'Suporte', MessageCircle], ['mapa', 'Mapa', MapIcon]] as [Tab, string, React.ElementType][]).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)}
                className={clsx('flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg transition-colors',
                  tab === k ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-strong')}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </nav>
          <button onClick={() => signOut({ callbackUrl: '/login' })} className="ml-auto flex items-center gap-1.5 text-[12px] text-faint hover:text-red transition-colors">
            <LogOut size={13} /> Sair
          </button>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-5 py-6">
        {tab === 'contas' && <TabContas />}
        {tab === 'assinaturas' && <TabAssinaturas />}
        {tab === 'dashboard' && <TabDashboard />}
        {tab === 'acessos' && <TabAcessos />}
        {tab === 'suporte' && <AdminFeedback />}
        {tab === 'mapa' && <TabMapa />}
      </main>
    </div>
  )
}

// ── TAB 1 — Contas ────────────────────────────────────────────────────────────

function TabContas() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<null | { tipo: 'criar' | 'editar'; user?: Usuario }>(null)
  const [excluir, setExcluir] = useState<Usuario | null>(null)
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams(); if (busca) p.set('busca', busca)
    const d = await fetch(`/api/admin/contas?${p}`).then((r) => r.json()).catch(() => ({}))
    setUsuarios(d.usuarios ?? [])
    setLoading(false)
  }, [busca])
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])

  async function toggleSuspenso(u: Usuario) {
    await fetch(`/api/admin/contas/${encodeURIComponent(u.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suspenso: !u.suspenso }) })
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-[20px]">Contas</h1>
          <p className="text-[12px] text-muted">{usuarios.length} conta(s) · exclusão é soft delete + auditoria</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome/e-mail/empresa"
            className="text-[12px] bg-bg2 border border-subtle rounded-lg px-3 py-2 text-strong placeholder:text-faint w-56 focus:border-accent outline-none" />
          <button onClick={() => setModal({ tipo: 'criar' })} className="flex items-center gap-1.5 text-[12px] font-semibold bg-accent text-black px-3.5 py-2 rounded-lg hover:bg-accent2">
            <Plus size={14} /> Adicionar conta
          </button>
        </div>
      </div>

      <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-b border-subtle">
                {['Nome', 'E-mail', 'Empresa', 'Telefone', 'Plano', 'Status', 'Criada', 'Último acesso', 'Ações'].map((h) => (
                  <th key={h} className={clsx('px-3 py-2.5 font-medium', h === 'Ações' ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-faint">Carregando…</td></tr>
              ) : usuarios.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-faint">Nenhuma conta.</td></tr>
              ) : usuarios.map((u) => (
                <tr key={u.id} className="border-b border-subtle last:border-0 hover:bg-bg3">
                  <td className="px-3 py-2.5 text-strong">{u.nome || '—'}{u.role === 'master' && <span className="ml-1.5 text-[9px] text-accent font-mono-custom">MASTER</span>}</td>
                  <td className="px-3 py-2.5 text-muted">{u.email}</td>
                  <td className="px-3 py-2.5 text-muted">{u.empresa || '—'}</td>
                  <td className="px-3 py-2.5 text-muted">{u.telefone || '—'}</td>
                  <td className="px-3 py-2.5"><span className="text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full bg-bg4 text-muted border border-subtle2">{u.plano || '—'}</span></td>
                  <td className="px-3 py-2.5">
                    <span className={clsx('text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full border',
                      u.suspenso ? 'bg-red/15 text-red border-red/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30')}>
                      {u.suspenso ? 'Suspensa' : 'Ativa'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-faint font-mono-custom">{fmtData(u.criado_em)}</td>
                  <td className="px-3 py-2.5 text-faint font-mono-custom">{fmtDataHora(u.ultimo_acesso)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      {u.role !== 'master' && (
                        <>
                          <button onClick={() => setModal({ tipo: 'editar', user: u })} title="Editar" className="text-faint hover:text-accent">Editar</button>
                          <button onClick={() => toggleSuspenso(u)} title={u.suspenso ? 'Reativar' : 'Suspender'} className="text-faint hover:text-amber">
                            {u.suspenso ? <CheckCircle2 size={14} /> : <Ban size={14} />}
                          </button>
                          <button onClick={() => setExcluir(u)} title="Excluir" className="text-faint hover:text-red"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && <ContaModal modal={modal} onClose={() => setModal(null)} onSaved={(s) => { setModal(null); if (s) setSenhaGerada(s); load() }} />}
      {excluir && <ExcluirModal user={excluir} onClose={() => setExcluir(null)} onDone={() => { setExcluir(null); load() }} />}
      {senhaGerada && <SenhaModal dados={senhaGerada} onClose={() => setSenhaGerada(null)} />}
    </div>
  )
}

function ContaModal({ modal, onClose, onSaved }: { modal: { tipo: 'criar' | 'editar'; user?: Usuario }; onClose: () => void; onSaved: (senha?: { email: string; senha: string }) => void }) {
  const u = modal.user
  const [f, setF] = useState({ email: u?.email ?? '', nome: u?.nome ?? '', empresa: u?.empresa ?? '', instituicao: u?.instituicao ?? '', telefone: u?.telefone ?? '', cpf: u?.cpf ?? '', cnpj: u?.cnpj ?? '', endereco: u?.endereco ?? '', plano: (u?.plano && ['pro', 'growth', 'enterprise'].includes(u.plano.toLowerCase())) ? 'pro' : 'essencial', status_assinatura: u?.status_assinatura ?? 'trial', expira_em: u?.expira_em ?? '' })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true); setErro('')
    const body: Record<string, unknown> = { nome: f.nome || undefined, empresa: f.empresa || undefined, instituicao: f.instituicao || undefined, telefone: f.telefone || undefined, cpf: f.cpf || undefined, cnpj: f.cnpj || undefined, endereco: f.endereco || undefined, plano: u?.role === 'master' ? undefined : (f.plano || undefined), status_assinatura: f.status_assinatura || undefined, expira_em: f.expira_em || null }
    let res: Response
    if (modal.tipo === 'criar') { body.email = f.email; res = await fetch('/api/admin/contas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
    else { res = await fetch(`/api/admin/contas/${encodeURIComponent(u!.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
    const d = await res.json().catch(() => ({}))
    setSalvando(false)
    if (!res.ok) { setErro(d.error ?? 'Erro'); return }
    onSaved(d.senhaTemporaria ? { email: d.usuario.email, senha: d.senhaTemporaria } : undefined)
  }

  return (
    <Overlay onClose={onClose}>
      <h2 className="font-heading font-semibold text-[16px] mb-3">{modal.tipo === 'criar' ? 'Adicionar conta' : `Editar ${u?.email}`}</h2>
      <div className="space-y-2.5">
        {modal.tipo === 'criar' && <Campo label="E-mail *"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inp} placeholder="cliente@empresa.com.br" /></Campo>}
        <Campo label="Nome"><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={inp} /></Campo>
        <div className="grid grid-cols-2 gap-2.5">
          <Campo label="Empresa"><input value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} className={inp} /></Campo>
          <Campo label="Instituição de trabalho"><input value={f.instituicao} onChange={(e) => setF({ ...f, instituicao: e.target.value })} className={inp} /></Campo>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Campo label="Telefone"><input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} className={inp} placeholder="(11) 90000-0000" /></Campo>
          <Campo label="CPF"><input value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} className={inp} placeholder="000.000.000-00" /></Campo>
          <Campo label="CNPJ"><input value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} className={inp} placeholder="00.000.000/0000-00" /></Campo>
        </div>
        <Campo label="Endereço"><input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} className={inp} placeholder="Rua, nº, cidade/UF" /></Campo>
        <div className="grid grid-cols-3 gap-2.5">
          <Campo label="Plano">{u?.role === 'master'
            ? <div className={inp + ' flex items-center text-muted'}>master (admin)</div>
            : <select value={f.plano} onChange={(e) => setF({ ...f, plano: e.target.value })} className={inp}><option value="essencial">Essencial</option><option value="pro">Pro</option></select>}</Campo>
          <Campo label="Assinatura"><select value={f.status_assinatura} onChange={(e) => setF({ ...f, status_assinatura: e.target.value })} className={inp}>{['trial', 'ativa', 'expirada'].map((p) => <option key={p}>{p}</option>)}</select></Campo>
          <Campo label="Expira em"><input type="date" value={f.expira_em ?? ''} onChange={(e) => setF({ ...f, expira_em: e.target.value })} className={inp} /></Campo>
        </div>
      </div>
      {erro && <p className="text-[12px] text-red mt-3">{erro}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="text-[12px] px-3 py-2 text-muted hover:text-strong">Cancelar</button>
        <button onClick={salvar} disabled={salvando} className="flex items-center gap-1.5 text-[12px] font-semibold bg-accent text-black px-3.5 py-2 rounded-lg hover:bg-accent2 disabled:opacity-60">
          {salvando && <Loader2 size={13} className="animate-spin" />} {modal.tipo === 'criar' ? 'Criar' : 'Salvar'}
        </button>
      </div>
    </Overlay>
  )
}

function ExcluirModal({ user, onClose, onDone }: { user: Usuario; onClose: () => void; onDone: () => void }) {
  const [txt, setTxt] = useState('')
  const [erro, setErro] = useState('')
  const [x, setX] = useState(false)
  async function confirmar() {
    setX(true); setErro('')
    const res = await fetch(`/api/admin/contas/${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmarEmail: txt }) })
    const d = await res.json().catch(() => ({})); setX(false)
    if (!res.ok) { setErro(d.error ?? 'Erro'); return }
    onDone()
  }
  return (
    <Overlay onClose={onClose}>
      <h2 className="font-heading font-semibold text-[16px] mb-1 text-red">Excluir conta</h2>
      <p className="text-[12px] text-muted mb-3">Soft delete (a conta é bloqueada e marcada como excluída, o histórico é preservado). Para confirmar, digite o e-mail <strong className="text-strong">{user.email}</strong>.</p>
      <input value={txt} onChange={(e) => setTxt(e.target.value)} className={inp} placeholder={user.email} />
      {erro && <p className="text-[12px] text-red mt-2">{erro}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="text-[12px] px-3 py-2 text-muted hover:text-strong">Cancelar</button>
        <button onClick={confirmar} disabled={x || txt.trim().toLowerCase() !== user.email.toLowerCase()} className="flex items-center gap-1.5 text-[12px] font-semibold bg-red text-white px-3.5 py-2 rounded-lg disabled:opacity-40">
          {x && <Loader2 size={13} className="animate-spin" />} Excluir
        </button>
      </div>
    </Overlay>
  )
}

function SenhaModal({ dados, onClose }: { dados: { email: string; senha: string }; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <h2 className="font-heading font-semibold text-[16px] mb-1">Conta criada</h2>
      <p className="text-[12px] text-muted mb-3">Senha temporária de <strong className="text-strong">{dados.email}</strong>. Ela é mostrada <strong>apenas uma vez</strong> — copie e envie ao usuário.</p>
      <div className="flex items-center gap-2 bg-bg3 border border-subtle rounded-lg px-3 py-2.5">
        <code className="flex-1 text-[14px] font-mono-custom text-accent">{dados.senha}</code>
        <button onClick={() => navigator.clipboard?.writeText(dados.senha)} title="Copiar" className="text-faint hover:text-strong"><Copy size={14} /></button>
      </div>
      <div className="flex justify-end mt-4"><button onClick={onClose} className="text-[12px] font-semibold bg-accent text-black px-3.5 py-2 rounded-lg hover:bg-accent2">Entendi</button></div>
    </Overlay>
  )
}

// ── TAB — Assinaturas (pendências do checkout) ────────────────────────────────

function TabAssinaturas() {
  const [linhas, setLinhas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch('/api/admin/assinaturas').then((r) => r.json()).then((d) => setLinhas(d.assinaturas ?? [])).catch(() => {}).finally(() => setLoading(false)) }, [])
  return (
    <div>
      <h1 className="font-heading font-bold text-[20px] mb-1">Assinaturas</h1>
      <p className="text-[12px] text-muted mb-4">{linhas.length} solicitação(ões) do checkout · a cobrança é concluída pelo gateway quando integrado.</p>
      <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-b border-subtle">
            {['Quando', 'Nome', 'E-mail', 'Empresa', 'CPF/CNPJ', 'Telefone', 'Plano', 'Método', 'Valor', 'Status'].map((h) => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={10} className="px-3 py-6 text-center text-faint">Carregando…</td></tr>
              : linhas.length === 0 ? <tr><td colSpan={10} className="px-3 py-6 text-center text-faint">Nenhuma solicitação de assinatura ainda.</td></tr>
              : linhas.map((a) => (
                <tr key={a.id} className="border-b border-subtle last:border-0 hover:bg-bg3">
                  <td className="px-3 py-2 text-faint font-mono-custom whitespace-nowrap">{fmtDataHora(a.criado_em)}</td>
                  <td className="px-3 py-2 text-strong">{a.nome || '—'}</td>
                  <td className="px-3 py-2 text-muted">{a.email}</td>
                  <td className="px-3 py-2 text-muted">{a.empresa || a.instituicao || '—'}</td>
                  <td className="px-3 py-2 text-muted font-mono-custom">{a.cpf_cnpj || '—'}</td>
                  <td className="px-3 py-2 text-muted">{a.telefone || '—'}</td>
                  <td className="px-3 py-2"><span className="text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">{planoPorId(a.plano)?.nome ?? a.plano}</span></td>
                  <td className="px-3 py-2 text-muted uppercase">{a.metodo || '—'}</td>
                  <td className="px-3 py-2 text-strong font-mono-custom">{a.valor != null ? formatarPreco(a.valor) : '—'}</td>
                  <td className="px-3 py-2"><span className={clsx('text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full border', a.status === 'ativa' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber/15 text-amber border-amber/30')}>{a.status}</span></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── TAB 2 — Dashboard ─────────────────────────────────────────────────────────

function TabDashboard() {
  const [d, setD] = useState<any>(null)
  useEffect(() => { fetch('/api/admin/dashboard').then((r) => r.json()).then(setD).catch(() => {}) }, [])
  if (!d) return <div className="text-faint text-[13px] py-10 text-center">Carregando…</div>
  const maxPlano = Math.max(1, ...(d.porPlano ?? []).map((p: any) => p.n))
  return (
    <div>
      <h1 className="font-heading font-bold text-[20px] mb-4">Dashboard gerencial</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Total de contas" v={d.totalContas} />
        <Kpi label="Ativas (login 30d)" v={d.ativos30} />
        <Kpi label="Novas no mês" v={d.novasMes} />
        <Kpi label="Acessos hoje" v={d.acessosHoje} />
      </div>

      {/* Análise de acessos: quem acessa & o que é mais acessado (filtros + gráficos) */}
      <div className="mb-6"><AdminAnalytics /></div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-bg2 border border-subtle rounded-xl p-4">
          <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">Distribuição por plano</div>
          <div className="space-y-2">
            {(d.porPlano ?? []).map((p: any) => (
              <div key={p.plano} className="flex items-center gap-2 text-[12px]">
                <span className="w-20 text-muted truncate">{p.plano}</span>
                <div className="flex-1 h-2 bg-bg4 rounded-full overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${(p.n / maxPlano) * 100}%` }} /></div>
                <span className="w-6 text-right font-mono-custom text-strong">{p.n}</span>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-faint mt-3">Acessos últimos 7 dias: <strong className="text-strong">{d.acessos7d}</strong></div>
        </div>
        <div className="bg-bg2 border border-subtle rounded-xl p-4">
          <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">Contas próximas de expirar (30d)</div>
          {(d.expirando ?? []).length === 0 ? <p className="text-[12px] text-faint">Nenhuma.</p> : (
            <div className="space-y-1.5">
              {(d.expirando ?? []).map((e: any) => (
                <div key={e.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-muted truncate">{e.email}</span>
                  <span className="text-amber font-mono-custom">{fmtData(e.expira_em)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── TAB 3 — Acessos ───────────────────────────────────────────────────────────

function TabAcessos() {
  const [linhas, setLinhas] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [dias, setDias] = useState('7')
  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams({ dias, limit: '100' }); if (busca) p.set('busca', busca)
    fetch(`/api/admin/acessos?${p}`).then((r) => r.json()).then((d) => { setLinhas(d.linhas ?? []); setTotal(d.total ?? 0) }).catch(() => {}).finally(() => setLoading(false))
  }, [busca, dias])
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div><h1 className="font-heading font-bold text-[20px]">Acessos</h1><p className="text-[12px] text-muted">{total} registro(s) · dado pessoal (LGPD): retenção 90 dias</p></div>
        <div className="flex items-center gap-2">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar e-mail/IP/cidade" className="text-[12px] bg-bg2 border border-subtle rounded-lg px-3 py-2 w-52 focus:border-accent outline-none" />
          <select value={dias} onChange={(e) => setDias(e.target.value)} className="text-[12px] bg-bg2 border border-subtle rounded-lg px-2 py-2 focus:border-accent outline-none">
            <option value="1">Hoje</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option>
          </select>
        </div>
      </div>
      <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-faint text-[10px] font-mono-custom uppercase tracking-wider border-b border-subtle">
            {['Quando', 'Usuário', 'Evento', 'IP', 'Local', 'Dispositivo'].map((h) => <th key={h} className="px-3 py-2.5 text-left font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="px-3 py-6 text-center text-faint">Carregando…</td></tr>
              : linhas.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-faint">Nenhum acesso no período.</td></tr>
              : linhas.map((a) => (
                <tr key={a.id} className="border-b border-subtle last:border-0 hover:bg-bg3">
                  <td className="px-3 py-2 text-faint font-mono-custom whitespace-nowrap">{fmtDataHora(a.criado_em)}</td>
                  <td className="px-3 py-2 text-strong">{a.email || a.user_id || '—'}</td>
                  <td className="px-3 py-2"><span className="text-[10px] font-mono-custom px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">{a.evento}</span></td>
                  <td className="px-3 py-2 text-muted font-mono-custom">{a.ip || '—'}</td>
                  <td className="px-3 py-2 text-muted">{[a.cidade, a.regiao, a.pais].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-faint truncate max-w-[220px]">{a.user_agent || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── TAB 4 — Mapa ──────────────────────────────────────────────────────────────

function TabMapa() {
  const [dias, setDias] = useState(30)
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div><h1 className="font-heading font-bold text-[20px]">Mapa de acessos</h1><p className="text-[12px] text-muted">Pontos por localização (geo dos acessos em produção)</p></div>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="text-[12px] bg-bg2 border border-subtle rounded-lg px-2 py-2 focus:border-accent outline-none">
          <option value={1}>Hoje</option><option value={7}>7 dias</option><option value={30}>30 dias</option>
        </select>
      </div>
      <AdminMapa dias={dias} />
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const inp = 'w-full text-[12px] bg-bg3 border border-subtle rounded-lg px-3 py-2 text-strong placeholder:text-faint focus:border-accent outline-none'

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[10px] font-mono-custom text-faint uppercase tracking-wide block mb-1">{label}</label>{children}</div>
}

function Kpi({ label, v }: { label: string; v: number }) {
  return <div className="bg-bg2 border border-subtle rounded-xl p-4"><div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">{label}</div><div className="font-heading font-bold text-[26px] text-strong leading-none">{v}</div></div>
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} className="relative bg-bg2 border border-subtle rounded-2xl shadow-2xl p-5 w-full max-w-[440px]">
        <button onClick={onClose} className="absolute right-3 top-3 text-faint hover:text-strong"><X size={16} /></button>
        {children}
      </div>
    </div>
  )
}
