'use client'
// src/app/conta/page.tsx — Minha Conta: plano, pagamento/faturamento e senha.

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Loader2, CreditCard, ShieldCheck, Save, CheckCircle2, AlertTriangle, Check,
  Building2, ExternalLink, KeyRound, Eye, EyeOff, Sparkles, XCircle,
} from 'lucide-react'
import { PLANOS, planoPorId, precoLabel } from '@/lib/planos'

const SUPORTE = 'contato@techealth.com.br'

interface Conta {
  id: string; email: string; nome: string | null
  empresa: string | null; telefone: string | null; instituicao: string | null
  endereco: string | null; cpf: string | null; cnpj: string | null
  plano: string | null; status_assinatura: string | null; expira_em: string | null
  temPagamento: boolean
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  trial:        { label: 'Teste grátis',       cls: 'bg-accent/15 text-accent border-accent/30' },
  ativa:        { label: 'Ativa',              cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  inadimplente: { label: 'Pagamento pendente', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  cancelada:    { label: 'Cancelada',          cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
}

function formatarData(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export default function ContaPage() {
  const [conta, setConta] = useState<Conta | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/conta', { cache: 'no-store' })
      if (!r.ok) throw new Error('falha')
      const j = await r.json()
      setConta(j.conta)
    } catch {
      setErro('Não foi possível carregar sua conta.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Minha Conta" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Minha Conta</h1>
            <p className="text-[13px] text-muted mt-1">Gerencie seu plano, forma de pagamento e senha de acesso.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin text-faint" /></div>
          ) : erro || !conta ? (
            <div className="max-w-[760px] flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-[13px] text-red-400">
              <AlertTriangle size={15} /> {erro ?? 'Conta indisponível.'}
            </div>
          ) : (
            <div className="space-y-5 max-w-[760px]">
              <PlanoCard conta={conta} />
              <PagamentoCard conta={conta} onSaved={carregar} />
              <SenhaCard />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Meu Plano ───────────────────────────────────────────────────────────────

function PlanoCard({ conta }: { conta: Conta }) {
  const [abrindoPortal, setAbrindoPortal] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const planoAtualId = (conta.plano ?? '').toLowerCase()
  const planoDef = planoPorId(planoAtualId)
  const nomePlano = planoDef?.nome ?? (conta.plano ? conta.plano.charAt(0).toUpperCase() + conta.plano.slice(1) : '—')
  const status = STATUS_LABEL[conta.status_assinatura ?? ''] ?? { label: conta.status_assinatura ?? '—', cls: 'bg-bg4 text-muted border-subtle' }
  const dataFmt = formatarData(conta.expira_em)
  const emTrial = conta.status_assinatura === 'trial'

  async function abrirPortal(): Promise<boolean> {
    setMsg(null)
    setAbrindoPortal(true)
    try {
      const r = await fetch('/api/conta/portal', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.url) { window.location.href = j.url; return true }
      setMsg(j.mensagem ?? 'Gestão de cobrança indisponível. Fale com o suporte.')
      return false
    } catch {
      setMsg('Não foi possível abrir a gestão de cobrança.')
      return false
    } finally {
      setAbrindoPortal(false)
    }
  }

  async function cancelar() {
    if (conta.temPagamento) { await abrirPortal(); return }
    window.location.href = `mailto:${SUPORTE}?subject=${encodeURIComponent('Cancelamento de plano — GovHealth AI')}&body=${encodeURIComponent(`Olá, gostaria de cancelar o plano da conta ${conta.email}.`)}`
  }

  return (
    <section className="bg-bg2 border border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={15} className="text-faint" />
        <h2 className="text-[13px] font-semibold text-strong">Meu Plano</h2>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-heading font-bold text-[20px] text-strong leading-none">{nomePlano}</span>
            <span className={clsx('text-[10.5px] font-medium px-2 py-0.5 rounded-full border', status.cls)}>{status.label}</span>
          </div>
          {planoDef && (
            <div className="text-[13px] text-muted mt-1.5">{precoLabel(planoDef)}{!planoDef.contato && <span className="text-faint">/{planoDef.ciclo}</span>}</div>
          )}
          {dataFmt && (
            <div className="text-[12px] text-faint mt-1">
              {emTrial ? `Teste expira em ${dataFmt}` : conta.status_assinatura === 'cancelada' ? `Encerrado em ${dataFmt}` : `Próxima renovação em ${dataFmt}`}
            </div>
          )}
        </div>
      </div>

      {planoDef && (
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {planoDef.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-[12px] text-muted">
              <Check size={13} className="text-accent mt-0.5 flex-shrink-0" /> {f}
            </li>
          ))}
        </ul>
      )}

      {/* Trocar de plano */}
      <div className="mt-5 pt-4 border-t border-subtle">
        <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wide mb-2.5">Trocar de plano</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PLANOS.map((p) => {
            const atual = p.id === planoAtualId
            return (
              <div key={p.id} className={clsx('rounded-lg border p-3 flex items-center justify-between gap-2', atual ? 'border-accent/40 bg-accent/5' : 'border-subtle bg-bg3')}>
                <div>
                  <div className="text-[13px] font-semibold text-strong">{p.nome}</div>
                  <div className="text-[11px] text-faint">{precoLabel(p)}{!p.contato && `/${p.ciclo}`}</div>
                </div>
                {atual ? (
                  <span className="text-[11px] text-accent font-medium flex items-center gap-1"><Check size={12} /> Atual</span>
                ) : p.contato ? (
                  <Link href={`/assinar?plano=${p.id}`} className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg bg-brand-blue/10 border border-brand-blue/30 text-brand-blue hover:bg-brand-blue/15 transition-colors">
                    Orçamento
                  </Link>
                ) : conta.temPagamento ? (
                  <button onClick={abrirPortal} disabled={abrindoPortal} className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-50">
                    Mudar
                  </button>
                ) : (
                  <Link href={`/assinar?plano=${p.id}`} className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg bg-accent text-black hover:bg-accent/90 transition-colors">
                    Assinar
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Cancelar */}
      <div className="mt-4 pt-4 border-t border-subtle flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px] text-faint">Não quer mais continuar? Você pode cancelar a qualquer momento.</div>
        <button onClick={cancelar} disabled={abrindoPortal} className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-subtle text-muted hover:text-red-400 hover:border-red-500/40 transition-colors flex items-center gap-1.5 disabled:opacity-50">
          <XCircle size={13} /> Cancelar plano
        </button>
      </div>

      {msg && <div className="mt-3 flex items-center gap-2 text-[12px] text-amber-400"><AlertTriangle size={13} /> {msg}</div>}
    </section>
  )
}

// ── Pagamento & Faturamento ───────────────────────────────────────────────────

function PagamentoCard({ conta, onSaved }: { conta: Conta; onSaved: () => void }) {
  const [form, setForm] = useState({
    nome: conta.nome ?? '', empresa: conta.empresa ?? '', cnpj: conta.cnpj ?? '',
    cpf: conta.cpf ?? '', telefone: conta.telefone ?? '', instituicao: conta.instituicao ?? '', endereco: conta.endereco ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [portalMsg, setPortalMsg] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState(false)

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); setSaved(false) }

  async function salvar() {
    setSaving(true)
    try {
      const r = await fetch('/api/conta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (r.ok) { setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2500) }
    } finally { setSaving(false) }
  }

  async function gerenciarPagamento() {
    setPortalMsg(null); setAbrindo(true)
    try {
      const r = await fetch('/api/conta/portal', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.url) { window.location.href = j.url; return }
      setPortalMsg(j.mensagem ?? 'Gestão de cobrança indisponível no momento.')
    } catch {
      setPortalMsg('Não foi possível abrir a gestão de cobrança.')
    } finally { setAbrindo(false) }
  }

  const campos: Array<{ k: keyof typeof form; label: string; ph?: string }> = [
    { k: 'nome', label: 'Nome' }, { k: 'empresa', label: 'Empresa' },
    { k: 'cnpj', label: 'CNPJ' }, { k: 'cpf', label: 'CPF' },
    { k: 'telefone', label: 'Telefone' }, { k: 'instituicao', label: 'Instituição' },
  ]

  return (
    <section className="bg-bg2 border border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <CreditCard size={15} className="text-faint" />
        <h2 className="text-[13px] font-semibold text-strong">Pagamento & Faturamento</h2>
      </div>

      {/* Forma de pagamento (cartão gerenciado pelo Stripe) */}
      <div className="rounded-lg border border-subtle bg-bg3 p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-2.5">
          <ShieldCheck size={16} className="text-accent mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-[12.5px] font-medium text-strong">
              {conta.temPagamento ? 'Cartão de crédito ativo' : 'Nenhuma forma de pagamento'}
            </div>
            <div className="text-[11.5px] text-faint mt-0.5">
              {conta.temPagamento
                ? 'Seus dados de cartão são gerenciados com segurança pelo Stripe.'
                : 'Assine um plano por cartão para gerenciar o pagamento aqui.'}
            </div>
          </div>
        </div>
        {conta.temPagamento ? (
          <button onClick={gerenciarPagamento} disabled={abrindo} className="text-[12px] font-semibold px-3.5 py-2 rounded-lg bg-accent text-black hover:bg-accent/90 transition-colors flex items-center gap-1.5 disabled:opacity-50">
            {abrindo ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            Gerenciar pagamento
          </button>
        ) : (
          <Link href="/assinar?plano=pro" className="text-[12px] font-semibold px-3.5 py-2 rounded-lg bg-accent text-black hover:bg-accent/90 transition-colors">
            Assinar
          </Link>
        )}
      </div>
      {portalMsg && <div className="mt-2.5 flex items-center gap-2 text-[12px] text-amber-400"><AlertTriangle size={13} /> {portalMsg}</div>}

      {/* Dados de faturamento (editáveis) */}
      <div className="mt-5 pt-4 border-t border-subtle">
        <div className="flex items-center gap-2 mb-3">
          <Building2 size={13} className="text-faint" />
          <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wide">Dados de faturamento</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {campos.map(({ k, label, ph }) => (
            <div key={k}>
              <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">{label}</label>
              <input
                value={form[k]}
                onChange={(e) => set(k, e.target.value)}
                placeholder={ph}
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Endereço</label>
            <input
              value={form.endereco}
              onChange={(e) => set('endereco', e.target.value)}
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={salvar}
            disabled={saving}
            className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-60', saved ? 'bg-emerald-500 text-white' : 'bg-accent text-black hover:bg-accent/90')}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
            {saved ? 'Salvo!' : 'Salvar dados'}
          </button>
        </div>
      </div>
    </section>
  )
}

// ── Trocar senha ──────────────────────────────────────────────────────────────

function SenhaCard() {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [ver, setVer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const forteOk = nova.trim().length >= 8 && /[A-Za-z]/.test(nova) && /[0-9]/.test(nova)
  const confereOk = nova.length > 0 && nova === confirma
  const podeEnviar = atual.length > 0 && forteOk && confereOk && !saving

  async function trocar() {
    setErro(null); setOk(false)
    if (!confereOk) { setErro('A confirmação não confere com a nova senha.'); return }
    if (!forteOk) { setErro('A nova senha precisa ter ao menos 8 caracteres, com letras e números.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/conta/senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) { setOk(true); setAtual(''); setNova(''); setConfirma(''); setTimeout(() => setOk(false), 3000) }
      else setErro(j.error ?? 'Não foi possível trocar a senha.')
    } catch {
      setErro('Não foi possível trocar a senha.')
    } finally { setSaving(false) }
  }

  const inputCls = 'w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent'

  return (
    <section className="bg-bg2 border border-subtle rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-faint" />
          <h2 className="text-[13px] font-semibold text-strong">Trocar senha</h2>
        </div>
        <button onClick={() => setVer((v) => !v)} className="text-[11px] text-faint hover:text-strong flex items-center gap-1">
          {ver ? <EyeOff size={12} /> : <Eye size={12} />} {ver ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 max-w-[420px]">
        <div>
          <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Senha atual</label>
          <input type={ver ? 'text' : 'password'} value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Nova senha</label>
          <input type={ver ? 'text' : 'password'} value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" className={inputCls} />
          <div className={clsx('text-[11px] mt-1.5 flex items-center gap-1', nova.length === 0 ? 'text-faint' : forteOk ? 'text-emerald-400' : 'text-amber-400')}>
            {nova.length > 0 && (forteOk ? <Check size={11} /> : <AlertTriangle size={11} />)}
            Mínimo 8 caracteres, com letras e números.
          </div>
        </div>
        <div>
          <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Confirmar nova senha</label>
          <input type={ver ? 'text' : 'password'} value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" className={inputCls} />
          {confirma.length > 0 && !confereOk && <div className="text-[11px] mt-1.5 text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> As senhas não conferem.</div>}
        </div>
      </div>

      {erro && <div className="mt-3 flex items-center gap-2 text-[12px] text-red-400"><AlertTriangle size={13} /> {erro}</div>}
      {ok && <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-400"><CheckCircle2 size={13} /> Senha alterada com sucesso.</div>}

      <div className="mt-4">
        <button
          onClick={trocar}
          disabled={!podeEnviar}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
          Trocar senha
        </button>
      </div>
    </section>
  )
}
