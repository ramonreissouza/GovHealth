'use client'
// src/app/documentos/page.tsx — Cofre de Documentos / Certidões (habilitação).
// Rastreia certidões com validade e avisa antes de vencer (o que trava participação
// em pregão). v1 híbrida: metadados + validade + link externo; o upload real de
// arquivo entra depois (botão já presente, desabilitado). Lê /api/documentos.
//
// ⛔ DESATIVADO (a pedido, 2026-07-26). A implementação abaixo (DocumentosPageOriginal)
//    fica PRESERVADA; o export default renderiza um aviso de "desativado". Para reativar:
//    trocar o export default de volta para DocumentosPageOriginal (e reverter Sidebar,
//    /api/documentos e o cron alertas-email). Ver memória cofre_documentos.

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { ShieldCheck, Plus, X, Pencil, Trash2, ExternalLink, Upload, AlertTriangle, Loader2, FileCheck2 } from 'lucide-react'
import {
  type Documento, type EstadoDoc, TIPOS_DOC, tipoLabel, estadoDoc, diasParaVencer, ESTADO_LABEL,
} from '@/lib/documentos'

const ESTADO_CLS: Record<EstadoDoc, string> = {
  valido: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/30',
  vencendo: 'bg-amber/15 text-amber border-amber/30',
  vencido: 'bg-red/15 text-red border-red/30',
  sem_validade: 'bg-bg4 text-faint border-subtle2',
}

type Filtro = 'todos' | EstadoDoc

function fmtData(s: string | null): string {
  if (!s) return '—'
  try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return s }
}
function selo(d: Documento, hojeMs: number): string {
  const e = estadoDoc(d, hojeMs)
  if (e === 'sem_validade') return ESTADO_LABEL.sem_validade
  const dias = diasParaVencer(d.validade, hojeMs)!
  if (e === 'vencido') return `Vencido há ${Math.abs(dias)}d`
  if (e === 'vencendo') return `Vence em ${dias}d`
  return `Válido (${dias}d)`
}

// ⛔ Export ativo: aviso de funcionalidade desativada. (o original é DocumentosPageOriginal)
export default function DocumentosPage() {
  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Cofre de Documentos" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-[420px] text-center">
            <ShieldCheck size={34} className="text-faint mx-auto mb-3" />
            <h1 className="font-heading font-bold text-[18px] text-strong">Funcionalidade desativada</h1>
            <p className="text-[13px] text-muted mt-2">
              O Cofre de Documentos está temporariamente desativado. Será reativado quando fizer sentido para o produto.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Implementação original preservada (inativa). Reativar = tornar esta o export default.
function DocumentosPageOriginal() {
  const [docs, setDocs] = useState<Documento[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [editando, setEditando] = useState<Documento | null>(null)
  const [novo, setNovo] = useState(false)
  const hojeMs = Date.now()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/documentos')
      const j = await r.json()
      setDocs(Array.isArray(j.documentos) ? j.documentos : [])
    } catch { setDocs([]) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function remover(id: string) {
    if (!confirm('Remover este documento do cofre?')) return
    await fetch(`/api/documentos?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setDocs((p) => p.filter((d) => d.id !== id))
  }

  const contagem = {
    todos: docs.length,
    vencido: docs.filter((d) => estadoDoc(d, hojeMs) === 'vencido').length,
    vencendo: docs.filter((d) => estadoDoc(d, hojeMs) === 'vencendo').length,
    valido: docs.filter((d) => estadoDoc(d, hojeMs) === 'valido').length,
    sem_validade: docs.filter((d) => estadoDoc(d, hojeMs) === 'sem_validade').length,
  }
  const filtrados = filtro === 'todos' ? docs : docs.filter((d) => estadoDoc(d, hojeMs) === filtro)

  const KPIS = [
    { label: 'Documentos', value: contagem.todos, destaque: false },
    { label: 'Vencidos', value: contagem.vencido, destaque: contagem.vencido > 0 },
    { label: 'Vencem em ≤30 dias', value: contagem.vencendo, destaque: contagem.vencendo > 0 },
    { label: 'Sem validade', value: contagem.sem_validade, destaque: false },
  ]
  const CHIPS: { key: Filtro; label: string }[] = [
    { key: 'todos', label: `Todos (${contagem.todos})` },
    { key: 'vencido', label: `Vencidos (${contagem.vencido})` },
    { key: 'vencendo', label: `Vencendo (${contagem.vencendo})` },
    { key: 'valido', label: `Válidos (${contagem.valido})` },
    { key: 'sem_validade', label: `Sem validade (${contagem.sem_validade})` },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Cofre de Documentos" subtitle="Certidões e habilitação — avisos antes de vencer" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-accent" />
                <h1 className="font-heading font-bold text-[20px] text-strong">Cofre de Documentos</h1>
              </div>
              <p className="text-[12px] text-muted mt-1 max-w-[640px]">
                Cadastre suas certidões de habilitação com a <strong className="text-strong">data de validade</strong> e
                receba aviso por e-mail antes de vencer — certidão vencida trava participação em pregão.
              </p>
            </div>
            <button onClick={() => setNovo(true)} className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md bg-accent text-black font-semibold hover:bg-accent2 transition-colors">
              <Plus size={14} /> Novo documento
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {KPIS.map((k) => (
              <div key={k.label} className={clsx('bg-bg2 border rounded-xl px-4 py-3', k.destaque ? 'border-accent/30' : 'border-subtle')}>
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{k.label}</div>
                <div className={clsx('text-[22px] font-mono-custom font-bold mt-0.5 leading-tight', k.destaque ? 'text-accent' : 'text-strong')}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {CHIPS.map((c) => (
              <button key={c.key} onClick={() => setFiltro(c.key)}
                className={clsx('text-[11px] font-mono-custom px-2.5 py-1.5 rounded-full border transition-colors',
                  filtro === c.key ? 'bg-accent/15 text-accent border-accent/30' : 'border-subtle2 text-faint hover:text-strong')}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Lista */}
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-bg2 border border-subtle rounded-lg animate-pulse" />)}</div>
          ) : filtrados.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-2xl p-10 text-center">
              <FileCheck2 size={28} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong mb-1">{docs.length === 0 ? 'Cofre vazio' : 'Nenhum documento neste filtro'}</p>
              <p className="text-[12px] text-muted max-w-[460px] mx-auto">
                {docs.length === 0
                  ? 'Cadastre suas certidões (Federal, FGTS, Trabalhista, estadual, municipal…) para acompanhar as validades num só lugar.'
                  : 'Ajuste o filtro acima para ver os demais documentos.'}
              </p>
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl divide-y divide-subtle">
              {filtrados.map((d) => {
                const e = estadoDoc(d, hojeMs)
                return (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-bg3 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-strong">{d.nome}</span>
                        <span className="text-[9px] font-mono-custom uppercase tracking-wide text-faint bg-bg4 px-1.5 py-0.5 rounded">{tipoLabel(d.tipo)}</span>
                      </div>
                      <div className="text-[10.5px] font-mono-custom text-faint mt-0.5">
                        {d.orgaoEmissor ? `${d.orgaoEmissor} · ` : ''}{d.numero ? `nº ${d.numero} · ` : ''}
                        Validade: {d.semValidade ? 'sem vencimento' : fmtData(d.validade)}
                      </div>
                    </div>
                    <span className={clsx('text-[10px] font-mono-custom px-2 py-1 rounded-full border flex-shrink-0', ESTADO_CLS[e])}>{selo(d, hojeMs)}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {d.arquivoUrl && <a href={d.arquivoUrl} target="_blank" rel="noopener noreferrer" title="Abrir documento" className="p-1 text-faint hover:text-accent transition-colors"><ExternalLink size={14} /></a>}
                      <button onClick={() => setEditando(d)} title="Editar" className="p-1 text-faint hover:text-strong transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => remover(d.id)} title="Remover" className="p-1 text-faint hover:text-red transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-[10px] text-faint mt-3">
            Os avisos de vencimento são enviados por e-mail para a conta titular (documentos que vencem em até 30 dias e vencidos).
          </p>
        </main>

        {(novo || editando) && (
          <DocModal
            doc={editando}
            onClose={() => { setNovo(false); setEditando(null) }}
            onSaved={(d) => {
              setDocs((p) => { const outros = p.filter((x) => x.id !== d.id); return [...outros, d] })
              setNovo(false); setEditando(null); load()
            }}
          />
        )}
      </div>
    </div>
  )
}

function DocModal({ doc, onClose, onSaved }: { doc: Documento | null; onClose: () => void; onSaved: (d: Documento) => void }) {
  const [tipo, setTipo] = useState(doc?.tipo ?? 'certidao_federal')
  const [nome, setNome] = useState(doc?.nome ?? '')
  const [numero, setNumero] = useState(doc?.numero ?? '')
  const [orgao, setOrgao] = useState(doc?.orgaoEmissor ?? '')
  const [emissao, setEmissao] = useState(doc?.emissao ?? '')
  const [validade, setValidade] = useState(doc?.validade ?? '')
  const [semValidade, setSemValidade] = useState(doc?.semValidade ?? false)
  const [arquivoUrl, setArquivoUrl] = useState(doc?.arquivoUrl ?? '')
  const [observacao, setObservacao] = useState(doc?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (!nome.trim()) { setErro('Dê um nome ao documento.'); return }
    if (!semValidade && !validade) { setErro('Informe a validade (ou marque “sem vencimento”).'); return }
    setSalvando(true); setErro(null)
    const body = { id: doc?.id, tipo, nome, numero, orgaoEmissor: orgao, emissao, validade, semValidade, arquivoUrl, observacao }
    try {
      const r = await fetch('/api/documentos', {
        method: doc ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) { setErro(j.error ?? 'Falha ao salvar'); setSalvando(false); return }
      if (j.documento) onSaved(j.documento)
      else onClose()
    } catch { setErro('Falha de rede'); setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div onClick={(e) => e.stopPropagation()} className="relative bg-bg2 border border-subtle rounded-2xl w-full max-w-[480px] p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-bold text-[16px] text-strong">{doc ? 'Editar documento' : 'Novo documento'}</h3>
          <button onClick={onClose} className="text-faint hover:text-strong"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] text-faint">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none">
              {TIPOS_DOC.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <Campo label="Nome / apelido" value={nome} onChange={setNome} placeholder="Ex.: CND Federal — matriz" />
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Número (opcional)" value={numero} onChange={setNumero} placeholder="nº do documento" />
            <Campo label="Órgão emissor (opcional)" value={orgao} onChange={setOrgao} placeholder="Receita, Caixa…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-faint">Emissão (opcional)</span>
              <input type="date" value={emissao ?? ''} onChange={(e) => setEmissao(e.target.value)} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none" />
            </label>
            <label className="block">
              <span className="text-[11px] text-faint">Validade {!semValidade && <span className="text-red">*</span>}</span>
              <input type="date" value={validade ?? ''} disabled={semValidade} onChange={(e) => setValidade(e.target.value)} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none disabled:opacity-40" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={semValidade} onChange={(e) => setSemValidade(e.target.checked)} className="accent-accent" />
            Documento sem vencimento (ex.: contrato social)
          </label>

          {/* Anexo — v1 híbrida: link externo agora; upload real em breve. */}
          <div>
            <span className="text-[11px] text-faint">Anexo</span>
            <div className="flex gap-2 mt-1">
              <input value={arquivoUrl} onChange={(e) => setArquivoUrl(e.target.value)} placeholder="Cole um link (Drive, OneDrive…)" className="flex-1 text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none" />
              <button type="button" disabled title="Upload de arquivo — em breve" className="flex items-center gap-1 text-[11px] px-2.5 py-2 rounded-md border border-subtle2 text-faint opacity-60 cursor-not-allowed flex-shrink-0">
                <Upload size={13} /> Upload
              </button>
            </div>
            <span className="text-[10px] text-faint">Upload de arquivo em breve — por ora, cole o link do documento.</span>
          </div>

          <label className="block">
            <span className="text-[11px] text-faint">Observação (opcional)</span>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none resize-none" />
          </label>
        </div>

        {erro && <p className="flex items-center gap-1.5 text-[12px] text-red mt-3"><AlertTriangle size={13} /> {erro}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[12px] px-3 py-2 rounded-md border border-subtle2 text-muted hover:text-strong">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="flex items-center gap-1.5 text-[12px] px-4 py-2 rounded-md bg-accent text-black font-semibold disabled:opacity-50">
            {salvando && <Loader2 size={13} className="animate-spin" />} {doc ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-faint">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full text-[13px] bg-bg3 border border-subtle rounded-md px-3 py-2 text-strong focus:border-accent outline-none" />
    </label>
  )
}
