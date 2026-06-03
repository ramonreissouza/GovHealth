'use client'
// src/app/editais/page.tsx — Workspace do Edital (dossiês de licitação)

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  FolderOpen, X, Trash2, Plus, Loader2, CheckCircle2, Circle, Clock,
  AlertTriangle, Link2, ExternalLink, FileText, Building2,
} from 'lucide-react'
import {
  getWorkspaces, getWorkspace, updateWorkspace, deleteWorkspace, calcularProgresso,
  WORKSPACE_STATUS,
  type EditalWorkspace, type WorkspaceStatus, type ChecklistItem, type PrazoItem,
} from '@/lib/edital-workspace'
import { formatBRL, formatDate, diasRestantes } from '@/lib/format'

function statusMeta(s: WorkspaceStatus) {
  return WORKSPACE_STATUS.find((x) => x.id === s) ?? WORKSPACE_STATUS[0]
}
function genId(p = 'x') { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` }

export default function EditaisPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-bg"><Sidebar /><div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-faint" /></div></div>}>
      <EditaisInner />
    </Suspense>
  )
}

function EditaisInner() {
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [ws, setWs] = useState<EditalWorkspace[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(() => setWs(getWorkspaces()), [])

  useEffect(() => {
    refresh()
    setMounted(true)
  }, [refresh])

  // Abre automaticamente o dossiê referenciado por ?id= (vindo de /oportunidades).
  useEffect(() => {
    const id = searchParams.get('id')
    if (id && getWorkspace(id)) setSelectedId(id)
  }, [searchParams])

  const selected = selectedId ? ws.find((w) => w.id === selectedId) ?? null : null

  function mutate(id: string, patch: Partial<EditalWorkspace>) {
    updateWorkspace(id, patch)
    refresh()
  }

  function handleDelete(id: string) {
    if (!confirm('Remover este dossiê?')) return
    deleteWorkspace(id)
    setSelectedId(null)
    refresh()
  }

  if (!mounted) {
    return (
      <div className="flex h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title="Dossiês de Edital" />
          <div className="flex-1 flex items-center justify-center"><Loader2 size={22} className="animate-spin text-faint" /></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Dossiês de Edital" subtitle={`${ws.length} dossiê${ws.length !== 1 ? 's' : ''}`} />
        <div className="flex-1 overflow-y-auto p-6">

          <div className="mb-5 max-w-[640px]">
            <h1 className="font-heading font-bold text-[22px] text-strong leading-none">Workspace do Edital</h1>
            <p className="text-[13px] text-muted mt-1.5">
              Organize a participação em cada licitação: checklist de habilitação, prazos do certame,
              documentos e status. Crie um dossiê a partir de qualquer oportunidade em <a href="/oportunidades" className="text-accent hover:underline">Licitações</a>.
            </p>
          </div>

          {ws.length === 0 ? (
            <div className="bg-bg2 border border-dashed border-subtle2 rounded-xl py-16 flex flex-col items-center text-center max-w-[640px]">
              <FolderOpen size={34} className="text-faint mb-3" />
              <h3 className="text-[15px] font-semibold text-strong">Nenhum dossiê ainda</h3>
              <p className="text-[13px] text-muted mt-1 mb-5 max-w-[400px]">
                Abra uma licitação em Oportunidades e clique em &quot;Criar dossiê do edital&quot; para começar a acompanhar a habilitação e os prazos.
              </p>
              <a href="/oportunidades" className="px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors">
                Ir para Licitações
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-w-[1040px]">
              {ws.map((w) => (
                <WorkspaceCard key={w.id} w={w} onOpen={() => setSelectedId(w.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <WorkspaceDetail
          w={selected}
          onClose={() => setSelectedId(null)}
          onChange={(patch) => mutate(selected.id, patch)}
          onDelete={() => handleDelete(selected.id)}
        />
      )}
    </div>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────────

function WorkspaceCard({ w, onOpen }: { w: EditalWorkspace; onOpen: () => void }) {
  const prog = calcularProgresso(w)
  const meta = statusMeta(w.status)
  const dias = prog.proximoPrazo?.data ? diasRestantes(prog.proximoPrazo.data) : null

  return (
    <button onClick={onOpen} className="text-left bg-bg2 border border-subtle rounded-xl p-4 hover:border-subtle2 transition-all">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-strong leading-snug line-clamp-2">{w.titulo}</h3>
        <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border flex-shrink-0', meta.cor)}>{meta.label}</span>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-faint font-mono-custom">
        {w.uf && <span className="flex items-center gap-1"><Building2 size={11} /> {w.municipio}/{w.uf}</span>}
        {w.valorEstimado ? <span>· {formatBRL(w.valorEstimado)}</span> : null}
      </div>

      {/* progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-mono-custom mb-1">
          <span className="text-faint">Habilitação</span>
          <span className={clsx(prog.obrigatoriosPendentes === 0 ? 'text-emerald-400' : 'text-muted')}>
            {prog.feitosDocs}/{prog.totalDocs} · {prog.pctDocs}%
          </span>
        </div>
        <div className="h-1.5 bg-bg4 rounded-full overflow-hidden">
          <div className={clsx('h-full rounded-full', prog.obrigatoriosPendentes === 0 ? 'bg-emerald-500' : 'bg-accent')} style={{ width: `${prog.pctDocs}%` }} />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-subtle text-[10px] font-mono-custom">
        {prog.obrigatoriosPendentes > 0 && (
          <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={11} /> {prog.obrigatoriosPendentes} obrigatório(s) pendente(s)</span>
        )}
        {prog.proximoPrazo && (
          <span className={clsx('flex items-center gap-1 ml-auto', dias !== null && dias <= 3 ? 'text-red-400' : 'text-faint')}>
            <Clock size={11} /> {prog.proximoPrazo.rotulo}: {prog.proximoPrazo.data ? formatDate(prog.proximoPrazo.data) : '—'}
          </span>
        )}
      </div>
    </button>
  )
}

// ── Detalhe (slide-over) ─────────────────────────────────────────────────────────

function WorkspaceDetail({
  w, onClose, onChange, onDelete,
}: {
  w: EditalWorkspace
  onClose: () => void
  onChange: (patch: Partial<EditalWorkspace>) => void
  onDelete: () => void
}) {
  const [linkEditId, setLinkEditId] = useState<string | null>(null)
  const [novoDoc, setNovoDoc] = useState('')
  const [novoPrazo, setNovoPrazo] = useState('')
  const prog = calcularProgresso(w)

  // Checklist ops
  const toggleDoc = (id: string) =>
    onChange({ checklist: w.checklist.map((c) => c.id === id ? { ...c, feito: !c.feito } : c) })
  const setDocLink = (id: string, link: string) =>
    onChange({ checklist: w.checklist.map((c) => c.id === id ? { ...c, link } : c) })
  const removeDoc = (id: string) =>
    onChange({ checklist: w.checklist.filter((c) => c.id !== id) })
  const addDoc = () => {
    const label = novoDoc.trim(); if (!label) return
    const item: ChecklistItem = { id: genId('c'), label, grupo: 'Outros', feito: false, obrigatorio: false }
    onChange({ checklist: [...w.checklist, item] }); setNovoDoc('')
  }

  // Prazo ops
  const setPrazo = (id: string, patch: Partial<PrazoItem>) =>
    onChange({ prazos: w.prazos.map((p) => p.id === id ? { ...p, ...patch } : p) })
  const removePrazo = (id: string) =>
    onChange({ prazos: w.prazos.filter((p) => p.id !== id) })
  const addPrazo = () => {
    const rotulo = novoPrazo.trim(); if (!rotulo) return
    onChange({ prazos: [...w.prazos, { id: genId('p'), rotulo, feito: false }] }); setNovoPrazo('')
  }

  // Agrupa checklist por grupo preservando ordem
  const grupos = w.checklist.reduce<Record<string, ChecklistItem[]>>((acc, c) => {
    (acc[c.grupo] ??= []).push(c); return acc
  }, {})

  return (
    <div className="fixed inset-0 z-[300] flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-[560px] bg-bg2 border-l border-subtle h-full overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-bg2 border-b border-subtle px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-strong leading-snug">{w.titulo}</h2>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-bg3 text-faint hover:text-strong flex-shrink-0"><X size={16} /></button>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {WORKSPACE_STATUS.map((s) => (
              <button key={s.id} onClick={() => onChange({ status: s.id })}
                className={clsx('text-[10px] font-mono-custom px-2 py-0.5 rounded-full border transition-all',
                  w.status === s.id ? s.cor : 'border-subtle2 text-faint hover:text-strong')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Metadados */}
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <Info label="Órgão" value={w.orgao} />
            <Info label="Local" value={w.uf ? `${w.municipio}/${w.uf}` : undefined} />
            <Info label="Valor estimado" value={w.valorEstimado ? formatBRL(w.valorEstimado) : undefined} />
            <Info label="PNCP" value={w.numeroControlePNCP} />
          </div>
          {w.linkEdital && (
            <a href={w.linkEdital} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-faint hover:text-accent transition-colors">
              <ExternalLink size={12} /> Ver edital no sistema de origem
            </a>
          )}

          {/* Checklist de habilitação */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-semibold text-strong flex items-center gap-1.5"><CheckCircle2 size={14} className="text-faint" /> Checklist de habilitação</h3>
              <span className={clsx('text-[11px] font-mono-custom', prog.obrigatoriosPendentes === 0 ? 'text-emerald-400' : 'text-muted')}>
                {prog.feitosDocs}/{prog.totalDocs}
              </span>
            </div>

            <div className="space-y-3">
              {Object.entries(grupos).map(([grupo, itens]) => (
                <div key={grupo}>
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">{grupo}</div>
                  <div className="space-y-1">
                    {itens.map((c) => (
                      <div key={c.id} className="bg-bg3/40 rounded-lg px-2.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleDoc(c.id)} className="flex-shrink-0">
                            {c.feito ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Circle size={15} className="text-faint" />}
                          </button>
                          <span className={clsx('text-[12px] flex-1', c.feito ? 'text-faint line-through' : 'text-strong')}>
                            {c.label}
                            {c.obrigatorio && <span className="text-red-400 ml-1" title="Obrigatório">*</span>}
                          </span>
                          <button onClick={() => setLinkEditId(linkEditId === c.id ? null : c.id)}
                            title="Link do documento"
                            className={clsx('p-1 rounded hover:bg-bg4 flex-shrink-0', c.link ? 'text-accent' : 'text-faint')}>
                            <Link2 size={12} />
                          </button>
                          {!c.obrigatorio && (
                            <button onClick={() => removeDoc(c.id)} className="p-1 rounded hover:bg-bg4 text-faint hover:text-red-400 flex-shrink-0"><Trash2 size={11} /></button>
                          )}
                        </div>
                        {(linkEditId === c.id || c.link) && (
                          <div className="flex items-center gap-1.5 mt-1.5 pl-7">
                            <input
                              value={c.link ?? ''}
                              onChange={(e) => setDocLink(c.id, e.target.value)}
                              placeholder="Cole o link do documento (Drive, etc.)"
                              className="flex-1 bg-bg border border-subtle rounded px-2 py-1 text-[11px] text-strong placeholder:text-faint focus:outline-none focus:border-accent"
                            />
                            {c.link && <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-accent"><ExternalLink size={12} /></a>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* add doc */}
            <div className="flex gap-2 mt-2">
              <input value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDoc()}
                placeholder="Adicionar documento…"
                className="flex-1 bg-bg3 border border-subtle rounded-lg px-2.5 py-1.5 text-[12px] text-strong placeholder:text-faint focus:outline-none focus:border-accent" />
              <button onClick={addDoc} disabled={!novoDoc.trim()} className="px-2.5 py-1.5 rounded-lg bg-bg4 border border-subtle text-faint hover:text-strong transition-colors disabled:opacity-40"><Plus size={14} /></button>
            </div>
          </section>

          {/* Prazos */}
          <section>
            <h3 className="text-[13px] font-semibold text-strong flex items-center gap-1.5 mb-2"><Clock size={14} className="text-faint" /> Prazos do certame</h3>
            <div className="space-y-1.5">
              {w.prazos.map((p) => {
                const dias = p.data ? diasRestantes(p.data) : null
                return (
                  <div key={p.id} className="flex items-center gap-2 bg-bg3/40 rounded-lg px-2.5 py-1.5">
                    <button onClick={() => setPrazo(p.id, { feito: !p.feito })} className="flex-shrink-0">
                      {p.feito ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Circle size={15} className="text-faint" />}
                    </button>
                    <span className={clsx('text-[12px] flex-1', p.feito ? 'text-faint line-through' : 'text-strong')}>{p.rotulo}</span>
                    {!p.feito && p.data && dias !== null && (
                      <span className={clsx('text-[10px] font-mono-custom', dias < 0 ? 'text-faint' : dias <= 3 ? 'text-red-400' : 'text-faint')}>
                        {dias < 0 ? 'venceu' : dias === 0 ? 'hoje' : `${dias}d`}
                      </span>
                    )}
                    <input type="date" value={p.data ?? ''} onChange={(e) => setPrazo(p.id, { data: e.target.value })}
                      className="bg-bg border border-subtle rounded px-2 py-1 text-[11px] text-strong focus:outline-none focus:border-accent" />
                    <button onClick={() => removePrazo(p.id)} className="p-1 rounded hover:bg-bg4 text-faint hover:text-red-400 flex-shrink-0"><Trash2 size={11} /></button>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2 mt-2">
              <input value={novoPrazo} onChange={(e) => setNovoPrazo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPrazo()}
                placeholder="Adicionar prazo…"
                className="flex-1 bg-bg3 border border-subtle rounded-lg px-2.5 py-1.5 text-[12px] text-strong placeholder:text-faint focus:outline-none focus:border-accent" />
              <button onClick={addPrazo} disabled={!novoPrazo.trim()} className="px-2.5 py-1.5 rounded-lg bg-bg4 border border-subtle text-faint hover:text-strong transition-colors disabled:opacity-40"><Plus size={14} /></button>
            </div>
          </section>

          {/* Notas */}
          <section>
            <h3 className="text-[13px] font-semibold text-strong flex items-center gap-1.5 mb-2"><FileText size={14} className="text-faint" /> Notas</h3>
            <textarea value={w.notas} onChange={(e) => onChange({ notas: e.target.value })} rows={4}
              placeholder="Anotações sobre estratégia, preço, concorrentes, riscos…"
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2 text-[12px] text-strong placeholder:text-faint focus:outline-none focus:border-accent resize-y" />
          </section>

          {/* Danger */}
          <div className="pt-2 border-t border-subtle">
            <button onClick={onDelete} className="flex items-center gap-1.5 text-[12px] text-faint hover:text-red-400 transition-colors">
              <Trash2 size={13} /> Remover dossiê
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="bg-bg3/40 rounded-lg px-3 py-2">
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
      <div className="text-[12px] text-strong mt-0.5 leading-snug break-words">{value || '—'}</div>
    </div>
  )
}
