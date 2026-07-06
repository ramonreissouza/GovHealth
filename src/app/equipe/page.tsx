'use client'
// src/app/equipe/page.tsx — Equipe (assentos do plano). O titular convida por
// e-mail; cada convidado cria a própria senha. Respeita o limite do plano.

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Users, Mail, Loader2, Clock, Crown, ShieldCheck } from 'lucide-react'

interface Membro { id: string; email: string; nome: string | null; criado_em: string }
interface Convite { id: string; email: string; expira_em: string }
interface Info {
  titularId: string; souTitular: boolean; assentos: number
  membros: Membro[]; convitesPendentes: Convite[]; vagas: number
}

const ERRO: Record<string, string> = {
  sem_vagas: 'Sem vagas: você atingiu o limite de usuários do plano.',
  email_existe: 'Já existe uma conta com este e-mail.',
  ja_convidado: 'Este e-mail já tem um convite pendente.',
  email_invalido: 'E-mail inválido.',
}

export default function EquipePage() {
  const [info, setInfo] = useState<Info | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setInfo(await (await fetch('/api/equipe')).json()) } catch { setInfo(null) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function convidar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setOk('')
    if (!email.trim()) return
    setEnviando(true)
    const r = await fetch('/api/equipe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
    const d = await r.json().catch(() => ({}))
    setEnviando(false)
    if (!r.ok) { setErro(ERRO[d.erro] ?? 'Não foi possível convidar.'); return }
    setOk(`Convite enviado para ${d.email}.`); setEmail(''); load()
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
                      {enviando && <Loader2 size={14} className="animate-spin" />} Enviar convite
                    </button>
                  </form>
                  <p className="text-[11px] text-muted mt-2">Cada convidado cria a <strong>própria senha</strong> pelo link do e-mail — senhas nunca são compartilhadas.</p>
                  {erro && <p className="text-[12px] text-red-400 mt-2">{erro}</p>}
                  {ok && <p className="text-[12px] text-emerald-400 mt-2">{ok}</p>}
                </div>
              ) : (
                <div className="bg-bg2 border border-subtle rounded-xl p-4 text-[12px] text-muted flex items-center gap-2">
                  <ShieldCheck size={14} className="text-faint" /> Você é membro desta equipe. Só o titular da conta pode convidar novos usuários.
                </div>
              )}

              {/* Membros */}
              <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-subtle text-[10px] font-mono-custom text-faint uppercase tracking-wider flex items-center gap-1.5"><Users size={12} /> Usuários da conta</div>
                <div className="divide-y divide-subtle">
                  {info.membros.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-bg4 flex items-center justify-center text-[11px] font-semibold text-strong flex-shrink-0">
                        {(m.nome ?? m.email)[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-strong truncate flex items-center gap-1.5">
                          {m.nome ?? m.email}
                          {m.id === info.titularId && <span title="Titular"><Crown size={12} className="text-amber" /></span>}
                        </div>
                        <div className="text-[10px] font-mono-custom text-faint truncate">{m.email}</div>
                      </div>
                      <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">ativo</span>
                    </div>
                  ))}
                  {info.convitesPendentes.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
                      <div className="w-7 h-7 rounded-full bg-bg4 flex items-center justify-center flex-shrink-0"><Clock size={13} className="text-faint" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-muted truncate">{c.email}</div>
                        <div className="text-[10px] font-mono-custom text-faint">convite pendente · expira {c.expira_em}</div>
                      </div>
                      <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/30">pendente</span>
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
