'use client'
// src/app/edital/page.tsx — Copiloto de Edital (IA lê o PDF/TR e estrutura a análise)

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  FileText, Upload, Loader2, Sparkles, AlertTriangle, CheckCircle2, Clock,
  ShieldAlert, ListChecks, Building2, Boxes, X, FileWarning,
} from 'lucide-react'
import { extrairTextoPDF } from '@/lib/pdf'
import { getProdutos } from '@/lib/portfolio'
import type { AnaliseEdital } from '@/lib/types'
import { IA_HABILITADA } from '@/lib/features'
import { IADesativada } from '@/components/ui/IADesativada'

const SEV_STYLE: Record<string, string> = {
  alta:  'bg-red-500/15 text-red-400 border-red-500/30',
  media: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  baixa: 'bg-bg4 text-faint border-subtle2',
}
const SEV_LABEL: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }

export default function EditalPage() {
  const [texto, setTexto] = useState('')
  const [analise, setAnalise] = useState<AnaliseEdital | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [produtos, setProdutos] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setProdutos(getProdutos().filter((p) => p.ativo).map((p) => p.nome))
  }, [])

  const handleFile = useCallback(async (file: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setErro('Envie um arquivo PDF, ou cole o texto do edital abaixo.')
      return
    }
    setErro(null)
    setFileName(file.name)
    setPdfStatus('Extraindo texto do PDF…')
    try {
      const t = await extrairTextoPDF(file, (p, total) => setPdfStatus(`Lendo página ${p}/${total}…`))
      if (t.length < 200) {
        setErro('O PDF parece ser uma imagem/escaneado (pouco texto extraído). Cole o texto manualmente.')
        setPdfStatus(null)
        return
      }
      setTexto(t)
      setPdfStatus(`${t.length.toLocaleString('pt-BR')} caracteres extraídos`)
    } catch (e) {
      console.error(e)
      setErro('Não foi possível ler o PDF. Tente colar o texto do edital manualmente.')
      setPdfStatus(null)
    }
  }, [])

  async function analisar() {
    if (texto.trim().length < 200) {
      setErro('Cole o texto do edital (ou envie um PDF) — mínimo de algumas linhas.')
      return
    }
    setLoading(true)
    setErro(null)
    setAnalise(null)
    try {
      const res = await fetch('/api/edital/analise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, portfolio: produtos }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Erro')
      setAnalise(data.analise)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao analisar o edital.')
    } finally {
      setLoading(false)
    }
  }

  function limpar() {
    setTexto(''); setAnalise(null); setErro(null); setPdfStatus(null); setFileName(null)
  }

  if (!IA_HABILITADA) return <IADesativada title="Copiloto de Edital" />

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title="Copiloto de Edital" subtitle="Análise de edital/TR com IA" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[920px] mx-auto">

            {/* Intro */}
            <div className="flex items-start gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-purple/20 flex items-center justify-center flex-shrink-0">
                <Sparkles size={18} className="text-brand-purple" />
              </div>
              <div>
                <h1 className="font-heading font-bold text-[20px] text-strong leading-none">Copiloto de Edital</h1>
                <p className="text-[13px] text-muted mt-1.5 max-w-[640px]">
                  Envie o PDF do edital ou cole o texto. A IA extrai especificações, documentos de habilitação,
                  prazos, penalidades e sinaliza <span className="text-amber-400">cláusulas restritivas / possível direcionamento</span>.
                  {produtos.length > 0 && ' Também avalia a aderência ao seu portfólio.'}
                </p>
              </div>
            </div>

            {/* Input card */}
            <div className="bg-bg2 border border-subtle rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg3 border border-subtle text-[12px] text-strong hover:border-accent transition-colors"
                >
                  <Upload size={13} /> Enviar PDF
                </button>
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
                {fileName && (
                  <span className="flex items-center gap-1.5 text-[11px] font-mono-custom text-faint">
                    <FileText size={12} /> {fileName}
                    <button onClick={limpar} className="hover:text-red-400"><X size={11} /></button>
                  </span>
                )}
                {pdfStatus && <span className="text-[11px] font-mono-custom text-accent ml-auto">{pdfStatus}</span>}
              </div>

              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Cole aqui o texto do edital / Termo de Referência…"
                rows={8}
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[12px] text-strong placeholder:text-faint focus:outline-none focus:border-accent resize-y font-mono-custom leading-relaxed"
              />

              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] font-mono-custom text-faint">
                  {texto.length > 0 ? `${texto.length.toLocaleString('pt-BR')} caracteres` : 'Aguardando conteúdo'}
                  {produtos.length > 0 && <span className="ml-2 text-accent">· {produtos.length} produto(s) do portfólio no contexto</span>}
                </span>
                <div className="flex items-center gap-2">
                  {texto && (
                    <button onClick={limpar} className="px-3 py-2 rounded-lg bg-bg3 border border-subtle text-[12px] text-muted hover:text-strong transition-colors">
                      Limpar
                    </button>
                  )}
                  <button
                    onClick={analisar}
                    disabled={loading || texto.trim().length < 200}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black text-[13px] font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {loading ? 'Analisando…' : 'Analisar edital'}
                  </button>
                </div>
              </div>
            </div>

            {erro && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4 text-[12px] text-red-400">
                <FileWarning size={14} className="flex-shrink-0" /> {erro}
              </div>
            )}

            {/* Resultado */}
            {analise && <Resultado a={analise} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Render da análise ──────────────────────────────────────────────────────────

function Resultado({ a }: { a: AnaliseEdital }) {
  return (
    <div className="space-y-4">
      {/* Resumo + metadados */}
      <div className="bg-bg2 border border-subtle rounded-xl p-5">
        <h2 className="text-[15px] font-semibold text-strong mb-1.5">{a.objeto || 'Edital'}</h2>
        <p className="text-[13px] text-muted leading-relaxed">{a.resumo}</p>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Meta icon={Building2} label="Órgão" value={a.orgao} />
          <Meta icon={FileText} label="Modalidade" value={a.modalidade} />
          <Meta icon={CheckCircle2} label="Valor estimado" value={a.valorEstimado} />
        </div>
      </div>

      {/* Aderência ao portfólio */}
      {a.aderenciaPortfolio && (
        <Bloco icon={Boxes} title="Aderência ao seu portfólio" accent>
          <p className="text-[13px] text-muted leading-relaxed">{a.aderenciaPortfolio}</p>
        </Bloco>
      )}

      {/* Cláusulas restritivas — o diferencial */}
      {a.clausulasRestritivas?.length > 0 && (
        <Bloco icon={ShieldAlert} title="Cláusulas restritivas / possível direcionamento" warn>
          <div className="space-y-2.5">
            {a.clausulasRestritivas.map((c, i) => (
              <div key={i} className="border border-subtle rounded-lg p-3 bg-bg3/40">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[12px] text-strong leading-snug flex-1">&ldquo;{c.trecho}&rdquo;</span>
                  <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border flex-shrink-0 uppercase', SEV_STYLE[c.severidade] ?? SEV_STYLE.baixa)}>
                    {SEV_LABEL[c.severidade] ?? c.severidade}
                  </span>
                </div>
                <p className="text-[11px] text-faint leading-snug">{c.motivo}</p>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Especificações */}
        {a.especificacoes?.length > 0 && (
          <Bloco icon={ListChecks} title="Especificações técnicas exigidas">
            <Lista items={a.especificacoes} />
          </Bloco>
        )}
        {/* Habilitação */}
        {a.habilitacao?.length > 0 && (
          <Bloco icon={CheckCircle2} title="Documentos de habilitação">
            <Lista items={a.habilitacao} />
          </Bloco>
        )}
      </div>

      {/* Prazos */}
      {a.prazos?.length > 0 && (
        <Bloco icon={Clock} title="Prazos e datas">
          <div className="space-y-2">
            {a.prazos.map((p, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-[11px] font-mono-custom text-accent w-32 flex-shrink-0">{p.data || '—'}</span>
                <div className="min-w-0">
                  <span className="text-[12px] text-strong">{p.rotulo}</span>
                  {p.observacao && <span className="text-[11px] text-faint ml-1.5">· {p.observacao}</span>}
                </div>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Penalidades */}
        {a.penalidades?.length > 0 && (
          <Bloco icon={AlertTriangle} title="Penalidades">
            <Lista items={a.penalidades} />
          </Bloco>
        )}
        {/* Recomendações */}
        {a.recomendacoes?.length > 0 && (
          <Bloco icon={Sparkles} title="Recomendações para a proposta" accent>
            <Lista items={a.recomendacoes} />
          </Bloco>
        )}
      </div>

      <p className="text-[10px] text-faint font-mono-custom text-center pt-1">
        Análise gerada por IA — confira sempre contra o edital original antes de decidir.
      </p>
    </div>
  )
}

function Meta({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string }) {
  return (
    <div className="bg-bg3/40 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-mono-custom text-faint uppercase tracking-wider">
        <Icon size={11} /> {label}
      </div>
      <div className="text-[12px] text-strong mt-1 leading-snug">{value || '—'}</div>
    </div>
  )
}

function Bloco({ icon: Icon, title, children, accent, warn }: {
  icon: React.ElementType; title: string; children: React.ReactNode; accent?: boolean; warn?: boolean
}) {
  return (
    <div className={clsx(
      'bg-bg2 border rounded-xl p-5',
      warn ? 'border-amber-500/30' : accent ? 'border-accent/30' : 'border-subtle',
    )}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} className={clsx(warn ? 'text-amber-400' : accent ? 'text-accent' : 'text-faint')} />
        <h3 className="text-[13px] font-semibold text-strong">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Lista({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-[12px] text-muted leading-snug">
          <span className="text-faint mt-1 flex-shrink-0">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}
