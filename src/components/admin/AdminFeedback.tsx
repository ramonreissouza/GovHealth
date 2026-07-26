'use client'
// src/components/admin/AdminFeedback.tsx — Backlog de "Reporte um problema" (admin).
// Lista os issues reportados pelos usuários, filtra por status, mostra contexto e
// permite mover o status (inclui o GATE humano: aprovar/rejeitar/integrar a solução).
// Fases 2-3 (agente) vão preencher `analise`/`solucao`; aqui já reservamos o espaço.

import React, { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Loader2, Bug, Lightbulb, HelpCircle, Sparkles, RefreshCw, MapPin, Clock, User, CheckCircle2, XCircle, GitBranch, FileCode, Paperclip, FileText } from 'lucide-react'
import {
  STATUS_LABEL, TIPO_LABEL, SEVERIDADE_LABEL, STATUSES, formatBytes,
  type FeedbackIssue, type FeedbackTipo, type FeedbackStatus,
} from '@/lib/feedback'

const TIPO_ICON: Record<FeedbackTipo, React.ElementType> = {
  bug: Bug, sugestao: Lightbulb, duvida: HelpCircle, melhoria: Sparkles,
}

const STATUS_COR: Record<FeedbackStatus, string> = {
  novo: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  triado: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  em_analise: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  solucao_proposta: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  aprovado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejeitado: 'bg-red-500/15 text-red-400 border-red-500/30',
  integrado: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40',
}

const SEV_COR: Record<string, string> = {
  baixa: 'text-faint', media: 'text-muted', alta: 'text-amber-400', critica: 'text-red-400',
}

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function AdminFeedback() {
  const [issues, setIssues] = useState<FeedbackIssue[]>([])
  const [contagem, setContagem] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FeedbackStatus | 'todos'>('todos')
  const [sel, setSel] = useState<FeedbackIssue | null>(null)
  const [salvando, setSalvando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const qs = filtro === 'todos' ? '' : `?status=${filtro}`
      const res = await fetch(`/api/feedback${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Erro')
      setIssues(data.issues ?? [])
      setContagem(data.contagem ?? {})
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally { setLoading(false) }
  }, [filtro])

  useEffect(() => { load() }, [load])

  async function mudarStatus(id: string, status: FeedbackStatus) {
    setSalvando(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const data = await res.json()
      if (res.ok && data.issue) {
        // PATCH não devolve anexos — preserva os que já carregamos (evita sumir da tela).
        setIssues((prev) => prev.map((i) => (i.id === id ? { ...data.issue, anexos: i.anexos } : i)))
        setSel((s) => (s && s.id === id ? { ...data.issue, anexos: s.anexos } : s))
        load()
      }
    } finally { setSalvando(false) }
  }

  const total = Object.values(contagem).reduce((s, n) => s + n, 0)

  return (
    <div>
      {/* Filtro por status + refresh */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setFiltro('todos')}
          className={clsx('text-[11px] px-2.5 py-1 rounded-lg border transition-colors',
            filtro === 'todos' ? 'bg-accent/15 text-accent border-accent/30' : 'bg-bg2 border-subtle text-muted hover:text-strong')}>
          Todos <span className="font-mono-custom">{total}</span>
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFiltro(s)}
            className={clsx('text-[11px] px-2.5 py-1 rounded-lg border transition-colors',
              filtro === s ? 'bg-accent/15 text-accent border-accent/30' : 'bg-bg2 border-subtle text-muted hover:text-strong')}>
            {STATUS_LABEL[s]} <span className="font-mono-custom">{contagem[s] ?? 0}</span>
          </button>
        ))}
        <button onClick={load} title="Atualizar" className="ml-auto p-1.5 rounded-lg bg-bg2 border border-subtle text-faint hover:text-strong transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {erro ? (
        <div className="bg-bg2 border border-red/30 rounded-xl p-6 text-center text-[13px] text-red">{erro}</div>
      ) : loading ? (
        <div className="py-16 flex justify-center"><Loader2 size={20} className="animate-spin text-faint" /></div>
      ) : issues.length === 0 ? (
        <div className="py-16 text-center text-faint text-[13px]">Nenhum issue neste filtro.</div>
      ) : (
        <div className="grid grid-cols-[1fr_1.1fr] gap-3">
          {/* Lista */}
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {issues.map((i) => {
              const Icon = TIPO_ICON[i.tipo] ?? Bug
              const ativo = sel?.id === i.id
              return (
                <button key={i.id} onClick={() => setSel(i)}
                  className={clsx('w-full text-left bg-bg2 border rounded-xl p-3 transition-colors',
                    ativo ? 'border-accent/50' : 'border-subtle hover:border-subtle2')}>
                  <div className="flex items-center gap-2">
                    <Icon size={13} className="text-faint flex-shrink-0" />
                    <span className="text-[13px] text-strong font-medium truncate flex-1">{i.titulo}</span>
                    <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border flex-shrink-0', STATUS_COR[i.status])}>
                      {STATUS_LABEL[i.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono-custom text-faint">
                    <span>{TIPO_LABEL[i.tipo]}</span>
                    <span className={SEV_COR[i.severidade]}>· {SEVERIDADE_LABEL[i.severidade]}</span>
                    {i.contexto?.rota && <span className="flex items-center gap-0.5"><MapPin size={9} />{i.contexto.rota}</span>}
                    {(i.anexos ?? []).length > 0 && <span className="flex items-center gap-0.5" title="anexos"><Paperclip size={9} />{(i.anexos ?? []).length}</span>}
                    <span className="ml-auto flex items-center gap-0.5"><Clock size={9} />{fmt(i.criadoEm)}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Detalhe */}
          <div className="bg-bg2 border border-subtle rounded-xl p-4 self-start max-h-[70vh] overflow-y-auto">
            {!sel ? (
              <div className="py-16 text-center text-faint text-[13px]">Selecione um issue para ver os detalhes.</div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-[10px] font-mono-custom px-2 py-0.5 rounded-full border', STATUS_COR[sel.status])}>{STATUS_LABEL[sel.status]}</span>
                    <span className="text-[10px] font-mono-custom text-faint">{TIPO_LABEL[sel.tipo]} · {SEVERIDADE_LABEL[sel.severidade]}</span>
                    {sel.jiraKey && <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border border-blue-500/30 text-blue-400">{sel.jiraKey}</span>}
                  </div>
                  <h3 className="text-[15px] font-semibold text-strong mt-2 leading-tight">{sel.titulo}</h3>
                </div>

                {sel.descricao && (
                  <p className="text-[12px] text-muted whitespace-pre-wrap leading-snug border-t border-subtle pt-3">{sel.descricao}</p>
                )}

                {/* Anexos do relato (imagens = miniatura; txt/pdf = chip para abrir) */}
                {(sel.anexos ?? []).length > 0 && (
                  <div className="border-t border-subtle pt-3">
                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Paperclip size={11} /> Anexos ({(sel.anexos ?? []).length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(sel.anexos ?? []).map((a) => {
                        const href = `/api/feedback/anexo/${a.id}`
                        return a.mime.startsWith('image/') ? (
                          <a key={a.id} href={href} target="_blank" rel="noopener noreferrer"
                            title={`${a.nome} · ${formatBytes(a.tamanho)}`}
                            className="block w-20 h-20 rounded-lg overflow-hidden border border-subtle hover:border-accent/50 transition-colors">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={href} alt={a.nome} className="w-full h-full object-cover" />
                          </a>
                        ) : (
                          <a key={a.id} href={href} target="_blank" rel="noopener noreferrer" title={a.nome}
                            className="flex items-center gap-1.5 bg-bg3 border border-subtle rounded-lg px-2.5 py-2 text-[11px] text-muted hover:text-strong hover:border-accent/50 transition-colors">
                            <FileText size={13} className="text-accent flex-shrink-0" />
                            <span className="truncate max-w-[120px]">{a.nome}</span>
                            <span className="text-faint">{formatBytes(a.tamanho)}</span>
                          </a>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Quem reportou + contexto */}
                <div className="text-[11px] font-mono-custom text-faint space-y-1 border-t border-subtle pt-3">
                  <div className="flex items-center gap-1.5"><User size={11} /> {sel.userNome || sel.userEmail || '—'} {sel.plano && <span className="text-faint/70">· {sel.plano}</span>}</div>
                  {sel.contexto?.rota && <div className="flex items-center gap-1.5"><MapPin size={11} /> {sel.contexto.rota}</div>}
                  {sel.contexto?.userAgent && <div className="truncate" title={String(sel.contexto.userAgent)}>UA: {String(sel.contexto.userAgent)}</div>}
                  <div className="flex items-center gap-1.5"><Clock size={11} /> {fmt(sel.criadoEm)}</div>
                </div>

                {/* Triagem do agente */}
                {sel.analise && (
                  <div className="border-t border-subtle pt-3">
                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wide mb-1.5">Triagem</div>
                    <div className="text-[11px] text-muted flex flex-wrap gap-x-3 gap-y-1">
                      {sel.analise.categoria && <span>categoria: <span className="text-strong">{sel.analise.categoria}</span></span>}
                      {sel.analise.severidadeSugerida && <span>severidade sugerida: <span className="text-strong">{SEVERIDADE_LABEL[sel.analise.severidadeSugerida]}</span></span>}
                      {(sel.analise.componentes ?? []).length > 0 && <span>áreas: <span className="text-strong">{(sel.analise.componentes ?? []).join(', ')}</span></span>}
                      {sel.analise.modelo && <span className="text-faint/70">· {sel.analise.modelo}</span>}
                    </div>
                  </div>
                )}

                {/* Solução proposta do agente */}
                <div className="border-t border-subtle pt-3">
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wide mb-1.5">Solução proposta pelo agente</div>
                  {!sel.solucao ? (
                    <p className="text-[11px] text-faint italic">
                      Ainda sem solução — o worker do agente (<span className="font-mono-custom">npm run feedback:agent</span>) preenche aqui.
                    </p>
                  ) : sel.solucao.erro ? (
                    <p className="text-[11px] text-red">Falha do agente: {sel.solucao.erro}</p>
                  ) : (
                    <div className="space-y-2">
                      {sel.solucao.resumo && <p className="text-[12px] text-strong">{sel.solucao.resumo}</p>}
                      {sel.solucao.diagnostico && sel.solucao.diagnostico !== sel.solucao.plano && (
                        <p className="text-[11px] text-muted whitespace-pre-wrap leading-snug">{sel.solucao.diagnostico}</p>
                      )}
                      <div className="flex items-center gap-3 text-[10px] font-mono-custom text-faint flex-wrap">
                        {sel.solucao.branch && <span className="flex items-center gap-1"><GitBranch size={11} />{sel.solucao.branch}</span>}
                        {sel.solucao.risco && <span>risco: <span className={sel.solucao.risco === 'alto' ? 'text-red-400' : sel.solucao.risco === 'medio' ? 'text-amber-400' : 'text-emerald-400'}>{sel.solucao.risco}</span></span>}
                        {sel.solucao.modelo && <span className="text-faint/70">· {sel.solucao.modelo}</span>}
                      </div>
                      {(sel.solucao.arquivos ?? []).length > 0 && (
                        <div className="text-[10px] font-mono-custom text-muted">
                          <div className="flex items-center gap-1 text-faint mb-0.5"><FileCode size={11} /> {(sel.solucao.arquivos ?? []).length} arquivo(s)</div>
                          {(sel.solucao.arquivos ?? []).map((f) => <div key={f} className="truncate">{f}</div>)}
                        </div>
                      )}
                      {sel.solucao.diff && (
                        <pre className="text-[10px] leading-relaxed bg-bg border border-subtle rounded-lg p-2.5 overflow-x-auto max-h-[280px] font-mono-custom">
                          {sel.solucao.diff.split('\n').map((l, i) => (
                            <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-emerald-400' : l.startsWith('-') && !l.startsWith('---') ? 'text-red-400' : l.startsWith('@@') ? 'text-cyan-400' : 'text-muted'}>{l || ' '}</div>
                          ))}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* Gate humano de 1 clique */}
                {sel.status === 'solucao_proposta' && (
                  <div className="border-t border-subtle pt-3 flex items-center gap-2">
                    <button disabled={salvando} onClick={() => mudarStatus(sel.id, 'aprovado')}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-500/90 transition-colors disabled:opacity-50">
                      <CheckCircle2 size={14} /> Aprovar e integrar
                    </button>
                    <button disabled={salvando} onClick={() => mudarStatus(sel.id, 'rejeitado')}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-bg3 border border-subtle text-[12px] font-semibold text-muted hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-50">
                      <XCircle size={14} /> Rejeitar
                    </button>
                  </div>
                )}
                {sel.status === 'aprovado' && (
                  <p className="border-t border-subtle pt-3 text-[11px] text-emerald-400 flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> Aprovado — o worker vai fazer merge{sel.solucao?.branch ? ` da branch ${sel.solucao.branch}` : ''} e deploy.
                  </p>
                )}

                {/* Mover status (avançado) */}
                <details className="border-t border-subtle pt-3">
                  <summary className="text-[10px] font-mono-custom text-faint uppercase tracking-wide cursor-pointer">Mover status (avançado)</summary>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {STATUSES.map((s) => (
                      <button key={s} disabled={salvando || s === sel.status} onClick={() => mudarStatus(sel.id, s)}
                        className={clsx('text-[11px] px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40',
                          s === sel.status ? 'bg-accent/15 text-accent border-accent/30' : 'bg-bg3 border-subtle text-muted hover:text-strong')}>
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
