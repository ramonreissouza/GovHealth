'use client'
// src/app/radar/configuracoes/page.tsx — "Configurações do Monitorar Chat".
// Espelha a tela de configurações da ferramenta da ConLicitação: palavras-chave
// monitoradas (chips), interruptor de notificação, tipo de notificação (e-mail /
// aviso sonoro / push) e escopo (todas as mensagens × somente com palavra-chave).
//
// As palavras-chave vão para radar_regras (tipo 'keyword') via /api/radar/regras;
// as preferências de notificação vão para /api/radar/config. Grava sozinho (debounce)
// para o usuário não perder ajuste por esquecer de salvar.

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { ChevronLeft, X, Plus, Loader2, Check, AlertTriangle, Bell, Volume2, Mail, Monitor } from 'lucide-react'
import { CONFIG_PADRAO, type ConfigRadar, type EscopoNotificacao } from '@/lib/radar/config'

interface Chave { id: string; padrao: string; prioridade: string }

type Permissao = 'default' | 'granted' | 'denied' | 'indisponivel'

export default function RadarConfiguracoesPage() {
  const [config, setConfig] = useState<ConfigRadar>(CONFIG_PADRAO)
  const [chaves, setChaves] = useState<Chave[]>([])
  const [sugeridas, setSugeridas] = useState<string[]>([])
  const [nova, setNova] = useState('')
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [permPush, setPermPush] = useState<Permissao>('indisponivel')
  const primeiraCarga = useRef(true)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Estado real da permissão de notificação do navegador — o aviso "as notificações
  // estão desativadas" só faz sentido se refletir o navegador de verdade.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) { setPermPush('indisponivel'); return }
    setPermPush(Notification.permission as Permissao)
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/radar/config')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'falha')
      setConfig(j.config)
      setChaves(j.chaves ?? [])
      setSugeridas(j.sugeridas ?? [])
    } catch {
      setErro('Não foi possível carregar as configurações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])

  // Auto-save com debounce. Pula a primeira renderização (senão gravaria o default
  // por cima do que acabou de vir do banco).
  useEffect(() => {
    if (loading) return
    if (primeiraCarga.current) { primeiraCarga.current = false; return }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setSalvando(true); setErro(null)
      try {
        const r = await fetch('/api/radar/config', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
        })
        if (!r.ok) throw new Error('falha')
        setSalvo(true); setTimeout(() => setSalvo(false), 2000)
      } catch {
        setErro('Não foi possível salvar. Tente de novo.')
      } finally { setSalvando(false) }
    }, 600)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [config, loading])

  async function adicionar(padrao: string) {
    const p = padrao.trim()
    if (!p) return
    if (chaves.some((c) => c.padrao.toLowerCase() === p.toLowerCase())) { setNova(''); return }
    setErro(null)
    // Otimista: o chip aparece na hora; se a API falhar, desfaz.
    const provisorio: Chave = { id: `tmp:${p}`, padrao: p, prioridade: 'normal' }
    setChaves((c) => [...c, provisorio])
    setSugeridas((s) => s.filter((x) => x.toLowerCase() !== p.toLowerCase()))
    setNova('')
    try {
      const r = await fetch('/api/radar/regras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padrao: p }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'falha')
      setChaves((c) => c.map((x) => x.id === provisorio.id ? { ...x, id: j.id } : x))
    } catch {
      setChaves((c) => c.filter((x) => x.id !== provisorio.id))
      setErro(`Não foi possível adicionar "${p}".`)
    }
  }

  async function remover(c: Chave) {
    setErro(null)
    const antes = chaves
    setChaves((cs) => cs.filter((x) => x.id !== c.id))
    try {
      const r = await fetch(`/api/radar/regras?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('falha')
    } catch {
      setChaves(antes)
      setErro(`Não foi possível remover "${c.padrao}".`)
    }
  }

  async function pedirPermissaoPush() {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    try {
      const p = await Notification.requestPermission()
      setPermPush(p as Permissao)
      if (p === 'granted') setConfig((c) => ({ ...c, push: true }))
    } catch { /* usuário fechou o prompt */ }
  }

  const set = <K extends keyof ConfigRadar>(k: K, v: ConfigRadar[K]) => setConfig((c) => ({ ...c, [k]: v }))

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Configurações do Monitorar Chat" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          <Link href="/radar" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline mb-4">
            <ChevronLeft size={14} /> Voltar para o Monitorar Chat
          </Link>

          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <h1 className="font-heading font-bold text-[20px] text-strong">Configurações do Monitorar Chat</h1>
            <div className="text-[11px] h-4">
              {salvando ? <span className="flex items-center gap-1.5 text-faint"><Loader2 size={12} className="animate-spin" /> salvando…</span>
                : salvo ? <span className="flex items-center gap-1.5 text-emerald-400"><Check size={12} /> salvo</span> : null}
            </div>
          </div>

          {erro && (
            <div className="mb-4 flex items-start gap-2 bg-red/10 border border-red/30 rounded-lg px-4 py-3">
              <AlertTriangle size={15} className="text-red flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-red">{erro}</p>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 bg-bg2 border border-subtle rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="max-w-[820px] space-y-4">

              {/* ── Palavras-chave ─────────────────────────────────────────── */}
              <section className="bg-bg2 border border-subtle rounded-xl p-5">
                <label className="block">
                  <span className="text-[12px] font-semibold text-strong">Adicionar palavras-chave para o Monitorar Chat</span>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      value={nova}
                      onChange={(e) => setNova(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void adicionar(nova) } }}
                      placeholder="Digite a palavra"
                      className="flex-1 text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong placeholder:text-faint focus:border-accent outline-none"
                    />
                    <button onClick={() => void adicionar(nova)} disabled={!nova.trim()}
                      className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-40">
                      <Plus size={14} /> Adicionar
                    </button>
                  </div>
                </label>
                <p className="text-[11px] text-faint mt-2">
                  Vale o seu CNPJ, nome da empresa, marca, ou qualquer termo do pregão. Ignoramos acento e maiúscula.
                </p>

                <div className="mt-4">
                  <div className="text-[12px] font-semibold text-strong mb-2">Palavras-chave monitoradas</div>
                  {chaves.length === 0 ? (
                    <p className="text-[12px] text-faint">Nenhuma ainda — as regras built-in (convocação, prazo, recurso…) continuam valendo.</p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {chaves.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1.5 text-[12px] bg-bg3 border border-subtle2 rounded-md pl-1.5 pr-2.5 py-1">
                          <button onClick={() => void remover(c)} title={`Remover ${c.padrao}`}
                            className="text-faint hover:text-red transition-colors"><X size={12} /></button>
                          <span className="text-accent">{c.padrao}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {sugeridas.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-subtle">
                    <div className="text-[11px] text-faint mb-2">Sugestões do sistema — os termos que mais mudam o que você precisa fazer:</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {sugeridas.map((s) => (
                        <button key={s} onClick={() => void adicionar(s)}
                          className="inline-flex items-center gap-1 text-[12px] bg-bg3 border border-dashed border-subtle2 rounded-md px-2.5 py-1 text-muted hover:text-accent hover:border-accent transition-colors">
                          <Plus size={11} /> {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* ── Notificação de mensagens ───────────────────────────────── */}
              <section className="bg-bg2 border border-subtle rounded-xl p-5">
                <div className="text-[12px] font-semibold text-strong mb-2">Notificação de Mensagens</div>
                <button onClick={() => set('notificar', !config.notificar)}
                  className={clsx('inline-flex items-center gap-2 rounded-full pl-3 pr-1 py-1 transition-colors',
                    config.notificar ? 'bg-emerald-500/20' : 'bg-bg4')}>
                  <span className={clsx('text-[11px] font-bold', config.notificar ? 'text-emerald-400' : 'text-faint')}>
                    {config.notificar ? 'Ativo' : 'Inativo'}
                  </span>
                  <span className={clsx('w-4 h-4 rounded-full transition-colors', config.notificar ? 'bg-emerald-400' : 'bg-faint')} />
                </button>
                <p className="text-[11px] text-faint mt-2">
                  Desligado, o Radar continua capturando o chat — você só não recebe aviso.
                </p>

                <div className={clsx('mt-5 transition-opacity', !config.notificar && 'opacity-40 pointer-events-none')}>
                  <div className="text-[12px] font-semibold text-strong mb-2">Tipo de Notificação</div>
                  <div className="space-y-2">
                    <Marcar icone={<Mail size={13} />} label="E-mail" checked={config.email} onChange={(v) => set('email', v)}
                      dica="Enviado ao e-mail cadastrado da empresa." />
                    <Marcar icone={<Volume2 size={13} />} label="Aviso Sonoro" checked={config.avisoSonoro} onChange={(v) => set('avisoSonoro', v)}
                      dica="Toca um som quando chega mensagem com esta tela aberta." />
                    <div>
                      <Marcar icone={<Monitor size={13} />} label="Notificação na área de trabalho (Push notification)"
                        checked={config.push} onChange={(v) => set('push', v)}
                        dica="Aviso do sistema operacional, mesmo com a aba em segundo plano." />
                      {config.push && permPush !== 'granted' && (
                        <div className="mt-1.5 ml-6 inline-flex items-center gap-1.5 bg-amber/10 border border-amber/30 rounded-md px-2.5 py-1.5">
                          <AlertTriangle size={12} className="text-amber flex-shrink-0" />
                          <span className="text-[11px] text-amber">
                            {permPush === 'indisponivel' ? 'Este navegador não suporta notificações na área de trabalho.'
                              : permPush === 'denied' ? 'As notificações estão bloqueadas no navegador — libere nas permissões do site.'
                              : 'As notificações estão desativadas.'}
                          </span>
                          {permPush === 'default' && (
                            <button onClick={() => void pedirPermissaoPush()} className="text-[11px] font-semibold text-amber underline hover:no-underline">
                              Clique para ativar.
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="text-[12px] font-semibold text-strong mb-2">Receber notificações de</div>
                    <div className="space-y-2">
                      <Radio label="Todas as mensagens do chat" valor="todas" atual={config.escopo} onChange={(v) => set('escopo', v)} />
                      <Radio label="Somente mensagens com palavra-chave" valor="palavra_chave" atual={config.escopo} onChange={(v) => set('escopo', v)}
                        dica={chaves.length === 0 ? 'Você ainda não tem palavra-chave — nenhum aviso sairia.' : undefined} />
                    </div>
                  </div>
                </div>
              </section>

              <p className="text-[11px] text-faint flex items-start gap-1.5">
                <Bell size={12} className="flex-shrink-0 mt-0.5" />
                <span>
                  A configuração vale para a <strong className="text-muted">empresa toda</strong> — todo mundo do time
                  recebe o mesmo aviso. As palavras-chave também pintam os termos dentro da conversa.
                </span>
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Marcar({ label, checked, onChange, dica, icone }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; dica?: string; icone?: React.ReactNode
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 accent-accent cursor-pointer" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[12.5px] text-strong group-hover:text-accent transition-colors">
          {icone}{label}
        </span>
        {dica && <span className="block text-[10.5px] text-faint mt-0.5">{dica}</span>}
      </span>
    </label>
  )
}

function Radio({ label, valor, atual, onChange, dica }: {
  label: string; valor: EscopoNotificacao; atual: EscopoNotificacao; onChange: (v: EscopoNotificacao) => void; dica?: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input type="radio" checked={atual === valor} onChange={() => onChange(valor)}
        className="mt-0.5 w-3.5 h-3.5 accent-accent cursor-pointer" />
      <span className="min-w-0">
        <span className="text-[12.5px] text-strong group-hover:text-accent transition-colors">{label}</span>
        {dica && <span className="block text-[10.5px] text-amber mt-0.5">{dica}</span>}
      </span>
    </label>
  )
}
