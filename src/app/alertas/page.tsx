'use client'
// src/app/alertas/page.tsx — Alertas & Monitoramento

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Bell, Plus, Trash2, Edit2, X, Save, CheckCheck, AlertCircle,
  Search, MapPin, Tag, DollarSign, ToggleLeft, ToggleRight, Loader2, Mail, Send,
} from 'lucide-react'
import {
  getAlertaConfigs, createAlertaConfig, updateAlertaConfig, deleteAlertaConfig,
  getNotificacoes, addNotificacoes, marcarLida, marcarTodasLidas, contarNaoLidas,
  gerarNotificacoesDosMatches,
  type AlertaConfig, type AlertaNotificacao, type AlertaCategoria,
} from '@/lib/alertas'
import type { Alert } from '@/lib/types'
import { formatBRL } from '@/lib/format'
import NotificationToggle from '@/components/ui/NotificationToggle'

// ── Constants ────────────────────────────────────────────────────────────────

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

const CATEGORIAS: { key: AlertaCategoria; label: string }[] = [
  { key: 'imagem',      label: 'Imagem' },
  { key: 'uti',         label: 'UTI' },
  { key: 'laboratorio', label: 'Laboratório' },
  { key: 'cirurgia',    label: 'Cirurgia' },
  { key: 'oncologia',   label: 'Oncologia' },
  { key: 'outros',      label: 'Outros' },
]

const URGENCIA_CLASS: Record<string, string> = {
  alta:   'bg-red/15 text-red border border-red/30',
  media:  'bg-amber/15 text-amber border border-amber/30',
  normal: 'bg-bg4 text-faint border border-subtle2',
}

const TIPO_LABEL: Record<string, string> = {
  edital:       'Edital',
  concorrente:  'Concorrente',
  emenda:       'Emenda',
  vencimento:   'Vencimento',
  oportunidade: 'Oportunidade',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Modal ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  nome: '',
  termos: '',
  ufs: [] as string[],
  categorias: [] as AlertaCategoria[],
  valorMin: '',
  valorMax: '',
  ativo: true,
  emailHabilitado: false,
}

function AlertaModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: AlertaConfig | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(() => editing ? {
    nome: editing.nome,
    termos: editing.termos.join(', '),
    ufs: editing.ufs,
    categorias: editing.categorias,
    valorMin: editing.valorMin != null ? String(editing.valorMin) : '',
    valorMax: editing.valorMax != null ? String(editing.valorMax) : '',
    ativo: editing.ativo,
    emailHabilitado: editing.emailHabilitado ?? false,
  } : EMPTY_FORM)

  function toggleUF(uf: string) {
    setForm((p) => ({
      ...p,
      ufs: p.ufs.includes(uf) ? p.ufs.filter((u) => u !== uf) : [...p.ufs, uf],
    }))
  }

  function toggleCat(cat: AlertaCategoria) {
    setForm((p) => ({
      ...p,
      categorias: p.categorias.includes(cat) ? p.categorias.filter((c) => c !== cat) : [...p.categorias, cat],
    }))
  }

  function handleSave() {
    if (!form.nome.trim()) return
    const termos = form.termos.split(',').map((t) => t.trim()).filter(Boolean)
    const data = {
      nome: form.nome.trim(),
      termos,
      ufs: form.ufs,
      categorias: form.categorias,
      valorMin: form.valorMin ? Number(form.valorMin) : undefined,
      valorMax: form.valorMax ? Number(form.valorMax) : undefined,
      ativo: form.ativo,
      emailHabilitado: form.emailHabilitado,
    }
    if (editing) {
      updateAlertaConfig(editing.id, data)
    } else {
      createAlertaConfig(data)
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-bg2 border border-subtle rounded-xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle">
          <h2 className="font-heading font-semibold text-[15px] text-strong">
            {editing ? 'Editar Monitor' : 'Novo Monitor'}
          </h2>
          <button onClick={onClose} className="text-faint hover:text-strong transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Nome */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">Nome do monitor *</label>
            <input
              value={form.nome}
              onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
              placeholder="Ex: Tomógrafo SP urgente"
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </div>

          {/* Termos */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-1.5">
              <Search size={10} className="inline mr-1" />
              Palavras-chave (separadas por vírgula)
            </label>
            <input
              value={form.termos}
              onChange={(e) => setForm((p) => ({ ...p, termos: e.target.value }))}
              placeholder="tomógrafo, tomografia, CT scan"
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </div>

          {/* Categorias */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-2">
              <Tag size={10} className="inline mr-1" />
              Categorias (vazio = todas)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIAS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => toggleCat(c.key)}
                  className={clsx(
                    'px-2.5 py-1 rounded-full text-[11px] font-mono-custom transition-colors',
                    form.categorias.includes(c.key)
                      ? 'bg-accent text-black'
                      : 'bg-bg4 text-faint hover:text-strong'
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* UFs */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-2">
              <MapPin size={10} className="inline mr-1" />
              Estados (vazio = todos)
            </label>
            <div className="flex flex-wrap gap-1">
              {UFS.map((uf) => (
                <button
                  key={uf}
                  onClick={() => toggleUF(uf)}
                  className={clsx(
                    'px-2 py-0.5 rounded text-[10px] font-mono-custom transition-colors',
                    form.ufs.includes(uf)
                      ? 'bg-accent text-black'
                      : 'bg-bg4 text-faint hover:text-strong'
                  )}
                >
                  {uf}
                </button>
              ))}
            </div>
          </div>

          {/* Valor */}
          <div>
            <label className="text-[11px] font-mono-custom text-faint uppercase tracking-wide block mb-2">
              <DollarSign size={10} className="inline mr-1" />
              Faixa de valor (R$)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={form.valorMin}
                onChange={(e) => setForm((p) => ({ ...p, valorMin: e.target.value }))}
                placeholder="Mínimo"
                className="flex-1 bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
              />
              <input
                type="number"
                value={form.valorMax}
                onChange={(e) => setForm((p) => ({ ...p, valorMax: e.target.value }))}
                placeholder="Máximo"
                className="flex-1 bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Ativo */}
          <div className="flex items-center justify-between py-1">
            <span className="text-[13px] text-muted">Monitor ativo</span>
            <button onClick={() => setForm((p) => ({ ...p, ativo: !p.ativo }))}>
              {form.ativo ? (
                <ToggleRight size={22} className="text-accent" />
              ) : (
                <ToggleLeft size={22} className="text-faint" />
              )}
            </button>
          </div>

          {/* Email */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Mail size={13} className="text-faint" />
              <span className="text-[13px] text-muted">Notificação por email</span>
            </div>
            <button onClick={() => setForm((p) => ({ ...p, emailHabilitado: !p.emailHabilitado }))}>
              {form.emailHabilitado ? (
                <ToggleRight size={22} className="text-accent" />
              ) : (
                <ToggleLeft size={22} className="text-faint" />
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-subtle">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] text-muted hover:text-strong transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!form.nome.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            <Save size={13} />
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AlertasPage() {
  const [mounted, setMounted] = useState(false)
  const [configs, setConfigs] = useState<AlertaConfig[]>([])
  const [notifs, setNotifs] = useState<AlertaNotificacao[]>([])
  const [tab, setTab] = useState<'notificacoes' | 'monitores'>('notificacoes')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AlertaConfig | null>(null)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailResult, setEmailResult] = useState<'ok' | 'err' | null>(null)

  const reload = useCallback(() => {
    setConfigs(getAlertaConfigs())
    setNotifs(getNotificacoes())
  }, [])

  const fetchFeed = useCallback(async () => {
    setLoadingFeed(true)
    try {
      const res = await fetch('/api/alerts')
      const data = await res.json()
      const apiAlerts: Alert[] = data.alerts ?? []
      const allConfigs = getAlertaConfigs()

      const items = apiAlerts.map((a) => ({
        id: a.id,
        titulo: a.titulo,
        descricao: a.descricao,
        urgencia: a.urgencia,
        link: undefined,
      }))

      const matched = gerarNotificacoesDosMatches(items, allConfigs)
      const direct = apiAlerts.map((a): AlertaNotificacao => ({
        id: `feed:${a.id}`,
        alertaId: 'feed',
        alertaNome: 'Feed PNCP',
        titulo: a.titulo,
        descricao: a.descricao,
        urgencia: a.urgencia,
        lida: false,
        criadoEm: a.createdAt,
      }))

      addNotificacoes([...matched, ...direct])
      setNotifs(getNotificacoes())
    } catch { /* silent */ }
    finally { setLoadingFeed(false) }
  }, [])

  useEffect(() => {
    reload()
    setMounted(true)
  }, [reload])

  useEffect(() => {
    if (mounted) fetchFeed()
  }, [mounted, fetchFeed])

  const sendEmail = useCallback(async () => {
    const naoLidasList = notifs.filter((n) => !n.lida)
    if (naoLidasList.length === 0) return
    setSendingEmail(true)
    setEmailResult(null)
    try {
      const res = await fetch('/api/alertas/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifs: naoLidasList }),
      })
      setEmailResult(res.ok ? 'ok' : 'err')
    } catch {
      setEmailResult('err')
    } finally {
      setSendingEmail(false)
      setTimeout(() => setEmailResult(null), 4000)
    }
  }, [notifs])

  if (!mounted) {
    return (
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title="Alertas" />
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-faint" />
          </div>
        </div>
      </div>
    )
  }

  const naoLidas = notifs.filter((n) => !n.lida).length

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Alertas" />
        <div className="flex-1 overflow-y-auto p-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Alertas & Monitoramento</h1>
              <p className="text-[13px] text-muted mt-1">
                Configure monitoramentos e acompanhe notificações de novas licitações.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationToggle />
              <button
                onClick={() => { setEditing(null); setModalOpen(true) }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors"
              >
                <Plus size={14} />
                Novo Monitor
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-5 border-b border-subtle pb-0">
            {[
              { key: 'notificacoes', label: 'Notificações', count: naoLidas },
              { key: 'monitores',    label: 'Meus Monitores', count: configs.length },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
                  tab === t.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted hover:text-strong'
                )}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={clsx(
                    'text-[10px] font-mono-custom font-semibold px-1.5 py-0.5 rounded-full',
                    t.key === 'notificacoes' && naoLidas > 0
                      ? 'bg-red/20 text-red'
                      : 'bg-accent text-black'
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Notificações ─────────────────────────────────────────────────── */}
          {tab === 'notificacoes' && (
            <div>
              {/* Toolbar */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] text-faint font-mono-custom">
                  {loadingFeed
                    ? 'Atualizando feed…'
                    : `${notifs.length} notificação${notifs.length !== 1 ? 'ões' : ''} · ${naoLidas} não lida${naoLidas !== 1 ? 's' : ''}`}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchFeed()}
                    disabled={loadingFeed}
                    className="flex items-center gap-1 text-[11px] font-mono-custom text-faint hover:text-strong transition-colors disabled:opacity-40"
                  >
                    <Loader2 size={11} className={loadingFeed ? 'animate-spin' : ''} />
                    Atualizar
                  </button>
                  {naoLidas > 0 && (
                    <button
                      onClick={() => { marcarTodasLidas(); setNotifs(getNotificacoes()) }}
                      className="flex items-center gap-1 text-[11px] font-mono-custom text-faint hover:text-accent transition-colors"
                    >
                      <CheckCheck size={11} />
                      Marcar todas como lidas
                    </button>
                  )}
                  {naoLidas > 0 && (
                    <button
                      onClick={sendEmail}
                      disabled={sendingEmail}
                      className={clsx(
                        'flex items-center gap-1 text-[11px] font-mono-custom transition-colors disabled:opacity-50',
                        emailResult === 'ok' ? 'text-emerald-400' :
                        emailResult === 'err' ? 'text-red-400' :
                        'text-faint hover:text-accent'
                      )}
                    >
                      {sendingEmail ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                      {emailResult === 'ok' ? 'Email enviado!' :
                       emailResult === 'err' ? 'Erro ao enviar' :
                       'Enviar por email'}
                    </button>
                  )}
                </div>
              </div>

              {notifs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Bell size={28} className="text-faint mb-3" />
                  <p className="text-[13px] text-muted">Nenhuma notificação ainda.</p>
                  <p className="text-[12px] text-faint mt-1">Configure um monitor para começar a receber alertas.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notifs.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => { marcarLida(n.id); setNotifs(getNotificacoes()) }}
                      className={clsx(
                        'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all',
                        n.lida
                          ? 'bg-bg2 border-subtle opacity-60'
                          : 'bg-bg2 border-subtle hover:border-subtle2'
                      )}
                    >
                      <div className={clsx(
                        'w-2 h-2 rounded-full flex-shrink-0 mt-1.5',
                        n.lida ? 'bg-faint' : 'bg-accent'
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-strong leading-snug">{n.titulo}</div>
                            <div className="text-[12px] text-muted mt-0.5 leading-snug line-clamp-2">{n.descricao}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <span className={clsx('text-[10px] font-mono-custom px-2 py-0.5 rounded-full', URGENCIA_CLASS[n.urgencia])}>
                              {n.urgencia}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] font-mono-custom text-faint">{formatDate(n.criadoEm)}</span>
                          <span className="text-[10px] font-mono-custom text-faint">via {n.alertaNome}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Monitores ────────────────────────────────────────────────────── */}
          {tab === 'monitores' && (
            <div>
              {configs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <AlertCircle size={28} className="text-faint mb-3" />
                  <p className="text-[13px] text-muted">Nenhum monitor configurado.</p>
                  <p className="text-[12px] text-faint mt-1">Crie um monitor para ser notificado quando novas licitações aparecerem.</p>
                  <button
                    onClick={() => { setEditing(null); setModalOpen(true) }}
                    className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors"
                  >
                    <Plus size={14} />
                    Criar primeiro monitor
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {configs.map((c) => (
                    <div key={c.id} className="bg-bg2 border border-subtle rounded-xl p-4">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', c.ativo ? 'bg-emerald-400' : 'bg-faint')} />
                          <span className="text-[14px] font-medium text-strong truncate">{c.nome}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => { updateAlertaConfig(c.id, { ativo: !c.ativo }); reload() }}
                            className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-strong transition-colors"
                            title={c.ativo ? 'Desativar' : 'Ativar'}
                          >
                            {c.ativo ? <ToggleRight size={16} className="text-accent" /> : <ToggleLeft size={16} />}
                          </button>
                          <button
                            onClick={() => { setEditing(c); setModalOpen(true) }}
                            className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-strong transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => { deleteAlertaConfig(c.id); reload() }}
                            className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Termos */}
                      {c.termos.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {c.termos.map((t) => (
                            <span key={t} className="text-[10px] font-mono-custom bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Meta */}
                      <div className="flex flex-wrap gap-2 text-[10px] font-mono-custom text-faint">
                        {c.ufs.length > 0 && (
                          <span className="flex items-center gap-1">
                            <MapPin size={9} />
                            {c.ufs.join(', ')}
                          </span>
                        )}
                        {c.categorias.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Tag size={9} />
                            {c.categorias.join(', ')}
                          </span>
                        )}
                        {(c.valorMin != null || c.valorMax != null) && (
                          <span className="flex items-center gap-1">
                            <DollarSign size={9} />
                            {c.valorMin ? formatBRL(c.valorMin) : '0'} — {c.valorMax ? formatBRL(c.valorMax) : '∞'}
                          </span>
                        )}
                        <span className="ml-auto text-faint">desde {new Date(c.criadoEm).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {modalOpen && (
        <AlertaModal
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { reload(); setModalOpen(false) }}
        />
      )}
    </div>
  )
}
