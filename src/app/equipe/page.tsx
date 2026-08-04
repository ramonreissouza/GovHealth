'use client'
// src/app/equipe/page.tsx — Equipe (assentos do plano). O titular convida por
// e-mail; cada convidado cria a própria senha. Respeita o limite do plano.
// O link de aceite é sempre exibido (copiável) — funciona mesmo sem e-mail configurado.

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { Users, Mail, Loader2, Clock, Crown, ShieldCheck, Copy, Check, Trash2, X } from 'lucide-react'

interface Membro { id: string; email: string; nome: string | null; criado_em: string }
interface Convite { id: string; email: string; expira_em: string; link: string }
interface Info {
  titularId: string; souTitular: boolean; assentos: number
  membros: Membro[]; convitesPendentes: Convite[]; vagas: number
}

const ERRO: Record<string, string> = {
  sem_vagas: 'Sem vagas: você atingiu o limite de usuários do plano.',
  email_existe: 'Já existe uma conta com este e-mail.',
  ja_convidado: 'Este e-mail já tem um convite pendente.',
  email_invalido: 'E-mail inválido.',
  membro_invalido: 'Usuário não encontrado nesta equipe.',
  convite_invalido: 'Convite não encontrado.',
  nao_pode_remover_titular: 'O titular da conta não pode ser removido.',
}

/** Botão que copia um texto para a área de transferência, com feedback. */
function BotaoCopiar({ texto, label = 'Copiar link' }: { texto: string; label?: string }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 1800) } catch { /* noop */ }
  }
  return (
    <button onClick={copiar} type="button"
      className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom px-2 py-1 rounded-md bg-bg3 border border-subtle2 text-muted hover:text-strong hover:border-muted transition-colors">
      {copiado ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      {copiado ? 'Copiado!' : label}
    </button>
  )
}

export default function EquipePage() {
  const [info, setInfo] = useState<Info | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [novoConvite, setNovoConvite] = useState<{ email: string; link: string; enviado: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setInfo(await (await fetch('/api/equipe')).json()) } catch { setInfo(null) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function convidar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setNovoConvite(null)
    if (!email.trim()) return
    setEnviando(true)
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
    const d = await r.json().catch(() => ({}))
    setEnviando(false)
    if (!r.ok) { setErro(ERRO[d.erro] ?? 'Não foi possível convidar.'); return }
    setNovoConvite({ email: d.email, link: d.link, enviado: !!d.enviado })
    setEmail(''); load()
  }

  async function remover(membroId: string, label: string) {
    if (!confirm(`Remover ${label} da equipe? A conta perde o acesso e a vaga é liberada.`)) return
    const r = await fetch('/api/equipe', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membroId }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(ERRO[d.erro] ?? 'Não foi possível remover.'); return }
    setErro(''); load()
  }

  async function cancelar(conviteId: string, label: string) {
    if (!confirm(`Cancelar o convite de ${label}?`)) return
    const r = await fetch('/api/equipe', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conviteId }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(ERRO[d.erro] ?? 'Não foi possível cancelar.'); return }
    setErro(''); load()
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Equipe" subtitle={info ? `${info.membros.length} de ${info.assentos} usuário${info.assentos !== 1 ? 's' : ''} · ${info.vagas} vaga${info.vagas !== 1 ? 's' : ''}` : 'Carregando…'} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">
          {loading ? (
            <div className="flex items-center gap-2 text-faint text-[13px]"><Loader2 size={16} className="animate-spin" /> Carregando…</div>
          ) : !info ? (
            <div className="text-faint text-[13px]">Não foi possível carregar a equipe.</div>
          ) : (
            <div className="max-w-[760px] space-y-4">
              {/* Assentos */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Assentos do plano', value: String(info.assentos) },
                  { label: 'Em uso', value: String(info.membros.length) },
                  { label: 'Vagas', value: String(info.vagas) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                    <div className="text-[20px] font-mono-custom font-bold text-strong mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              {/* Convidar (só titular) */}
              {info.souTitular ? (
                <div className="bg-bg2 border border-subtle rounded-xl p-4">
                  <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5"><Mail size={12} /> Convidar usuário</div>
                  <form onSubmit={convidar} className="flex gap-2">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={info.vagas <= 0}
                      placeholder={info.vagas <= 0 ? 'Sem vagas disponíveis no plano' : 'email@empresa.com.br'}
                      className="flex-1 bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent disabled:opacity-50" />
                    <button type="submit" disabled={enviando || info.vagas <= 0 || !email.trim()}
                      className="flex items-center gap-1.5 bg-accent text-black font-semibold text-[13px] px-4 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-50">
                      {enviando && <Loader2 size={14} className="animate-spin" />} Gerar convite
                    </button>
                  </form>
                  <p className="text-[11px] text-muted mt-2">Cada convidado cria a <strong>própria senha</strong> pelo link — senhas nunca são compartilhadas.</p>
                  {erro && <p className="text-[12px] text-red-400 mt-2">{erro}</p>}

                  {/* Resultado do convite: link sempre visível (copiável) */}
                  {novoConvite && (
                    <div className="mt-3 bg-bg3 border border-accent/30 rounded-lg p-3">
                      <div className="text-[12px] text-strong mb-1.5">
                        Convite criado para <strong>{novoConvite.email}</strong>.
                      </div>
                      <div className="text-[11px] mb-2">
                        {novoConvite.enviado
                          ? <span className="text-emerald-400">✓ E-mail enviado com o link de acesso.</span>
                          : <span className="text-amber">O e-mail não pôde ser enviado (envio automático não configurado). <strong>Copie o link abaixo</strong> e mande para a pessoa.</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <input readOnly value={novoConvite.link} onFocus={(e) => e.target.select()}
                          className="flex-1 bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-[11px] font-mono-custom text-muted" />
                        <BotaoCopiar texto={novoConvite.link} />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-bg2 border border-subtle rounded-xl p-4 text-[12px] text-muted flex items-center gap-2">
                  <ShieldCheck size={14} className="text-faint" /> Você é membro desta equipe. Só o titular da conta pode convidar ou remover usuários.
                </div>
              )}

              {/* Membros */}
              <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-subtle text-[10px] font-mono-custom text-faint uppercase tracking-wider flex items-center gap-1.5"><Users size={12} /> Usuários da conta</div>
                <div className="divide-y divide-subtle">
                  {info.membros.map((m) => {
                    const ehTitular = m.id === info.titularId
                    return (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 group">
                        <div className="w-7 h-7 rounded-full bg-bg4 flex items-center justify-center text-[11px] font-semibold text-strong flex-shrink-0">
                          {(m.nome ?? m.email)[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-strong truncate flex items-center gap-1.5">
                            {m.nome ?? m.email}
                            {ehTitular && <span title="Titular"><Crown size={12} className="text-amber" /></span>}
                          </div>
                          <div className="text-[10px] font-mono-custom text-faint truncate">{m.email}</div>
                        </div>
                        <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">ativo</span>
                        {info.souTitular && !ehTitular && (
                          <button onClick={() => remover(m.id, m.nome ?? m.email)} title="Remover da equipe"
                            className="p-1 rounded text-faint hover:text-red-400 hover:bg-bg4 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {info.convitesPendentes.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-bg4 flex items-center justify-center flex-shrink-0"><Clock size={13} className="text-faint" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-muted truncate">{c.email}</div>
                        <div className="text-[10px] font-mono-custom text-faint">convite pendente · expira {c.expira_em}</div>
                      </div>
                      {info.souTitular && <BotaoCopiar texto={c.link} />}
                      <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/30">pendente</span>
                      {info.souTitular && (
                        <button onClick={() => cancelar(c.id, c.email)} title="Cancelar convite"
                          className="p-1 rounded text-faint hover:text-red-400 hover:bg-bg4 transition-colors">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
