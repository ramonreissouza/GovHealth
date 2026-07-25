'use client'
// src/app/edital/page.tsx — Copiloto de Edital (IA lê o PDF/TR e estrutura a análise)

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  FileText, Upload, Loader2, Sparkles, AlertTriangle, CheckCircle2, Clock,
  ShieldAlert, ListChecks, Building2, Boxes, X, FileWarning, Gavel, Scale, Copy, Check, Download,
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

const LS_EDITAL = 'govhealth:edital:ultima'

// Gera um relatório HTML autocontido (abre no navegador; "Imprimir → Salvar como PDF").
function relatorioHtml(a: AnaliseEdital, titulo: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c])
  const ul = (arr?: unknown[]) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="vazio">—</p>')
  const sec = (t: string, body: string) => (body ? `<section><h2>${esc(t)}</h2>${body}</section>` : '')

  const conclusao = a.conclusao
    ? `<p><strong>${esc(a.conclusao.participar)}</strong></p>
       ${a.conclusao.principaisVantagens?.length ? `<h3>Vantagens</h3>${ul(a.conclusao.principaisVantagens)}` : ''}
       ${a.conclusao.principaisRiscos?.length ? `<h3>Riscos</h3>${ul(a.conclusao.principaisRiscos)}` : ''}`
    : ''
  const restritivas = a.clausulasRestritivas?.length
    ? `<ul>${a.clausulasRestritivas.map((c) => `<li><em>“${esc(c.trecho)}”</em> — ${esc(c.motivo)} <span class="sev">[${esc(SEV_LABEL[c.severidade] ?? c.severidade)}]</span></li>`).join('')}</ul>`
    : ''
  const riscos = a.riscos?.length
    ? `<ul>${a.riscos.map((r) => `<li>${esc(r.descricao)} <span class="sev">[${esc(r.grau)}]</span>${r.mitigacao ? ` — <em>Mitigação:</em> ${esc(r.mitigacao)}` : ''}</li>`).join('')}</ul>`
    : ''
  const impPontos = a.impugnacao?.pontos?.length
    ? `<ul>${a.impugnacao.pontos.map((p) => `<li><strong>${esc(p.ponto)}</strong> — ${esc(p.fundamento)} <span class="sev">[${esc(p.relevancia)} · êxito ${esc(p.probabilidadeExito)}]</span></li>`).join('')}</ul>`
    : ''
  const impugnacao = a.impugnacao
    ? `<p><strong>${a.impugnacao.recomendada ? 'Impugnação recomendada' : 'Impugnação não recomendada'}</strong>${a.impugnacao.tipo && a.impugnacao.tipo !== 'nao' ? ` (${esc(a.impugnacao.tipo)})` : ''}${a.impugnacao.estrategia ? ` — ${esc(a.impugnacao.estrategia)}` : ''}</p>${impPontos}${a.impugnacao.minuta ? `<h3>Minuta de impugnação</h3><pre class="minuta">${esc(a.impugnacao.minuta)}</pre>` : ''}`
    : ''

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;max-width:820px;margin:32px auto;padding:0 20px;line-height:1.55}
  h1{font-size:22px;border-bottom:2px solid #16a34a;padding-bottom:8px}
  h2{font-size:16px;margin-top:26px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  h3{font-size:13px;margin:14px 0 4px;color:#334155}
  .meta{font-size:12px;color:#64748b;margin:6px 0 0}
  ul{margin:6px 0;padding-left:20px} li{margin:3px 0;font-size:13px}
  .sev{font-size:11px;color:#b45309;font-weight:bold}
  .vazio{color:#94a3b8;font-size:13px}
  .minuta{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:inherit;font-size:12.5px}
  footer{margin-top:30px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px}
</style></head><body>
  <h1>${esc(a.objeto || 'Análise de Edital')}</h1>
  <p class="meta">${esc(a.orgao || '')} ${a.modalidade ? '· ' + esc(a.modalidade) : ''} ${a.valorEstimado ? '· ' + esc(a.valorEstimado) : ''}</p>
  <p>${esc(a.resumo)}</p>
  ${sec('Conclusão executiva', conclusao)}
  ${sec('Aderência ao portfólio', a.aderenciaPortfolio ? `<p>${esc(a.aderenciaPortfolio)}</p>` : '')}
  ${sec('Análise legal (Lei 14.133/2021)', ul(a.analiseLegal))}
  ${sec('Cláusulas restritivas / direcionamento', restritivas)}
  ${sec('Riscos', riscos)}
  ${sec('Especificações técnicas', ul(a.especificacoes))}
  ${sec('Documentos de habilitação', ul(a.habilitacao))}
  ${sec('Prazos', a.prazos?.length ? `<ul>${a.prazos.map((p) => `<li><strong>${esc(p.data || '—')}</strong> — ${esc(p.rotulo)}${p.observacao ? ' · ' + esc(p.observacao) : ''}</li>`).join('')}</ul>` : '')}
  ${sec('Penalidades', ul(a.penalidades))}
  ${sec('Recomendações', ul(a.recomendacoes))}
  ${sec('Impugnação', impugnacao)}
  <footer>Relatório gerado pelo Copiloto de Edital — GovHealth.ai. Análise por IA; confira sempre contra o edital original.</footer>
</body></html>`
}

function baixarRelatorio(a: AnaliseEdital, fileName: string | null) {
  const html = relatorioHtml(a, a.objeto ? `Análise — ${a.objeto.slice(0, 60)}` : 'Análise de Edital')
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const base = (fileName ?? 'analise-edital').replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'analise-edital'
  link.href = url
  link.download = `${base}-analise.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

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
    // Restaura a última análise — não perder ao sair da tela e voltar.
    try {
      const raw = localStorage.getItem(LS_EDITAL)
      if (raw) { const o = JSON.parse(raw); if (o?.analise) { setAnalise(o.analise); if (o.fileName) setFileName(o.fileName) } }
    } catch { /* noop */ }
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
      // Persiste para não perder ao navegar para outra tela e voltar.
      try { localStorage.setItem(LS_EDITAL, JSON.stringify({ analise: data.analise, fileName, criadoEm: Date.now() })) } catch { /* noop */ }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao analisar o edital.')
    } finally {
      setLoading(false)
    }
  }

  function limpar() {
    setTexto(''); setAnalise(null); setErro(null); setPdfStatus(null); setFileName(null)
    try { localStorage.removeItem(LS_EDITAL) } catch { /* noop */ }
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
            {analise && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-mono-custom text-faint">Análise salva neste navegador — continua aqui quando você voltar.</span>
                  <button
                    onClick={() => baixarRelatorio(analise, fileName)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black text-[12px] font-semibold hover:bg-accent2 transition-colors"
                  >
                    <Download size={14} /> Baixar relatório
                  </button>
                </div>
                <Resultado a={analise} />
              </>
            )}
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

      {/* Conclusão executiva — o veredito primeiro */}
      {a.conclusao && (
        <Bloco icon={CheckCircle2} title="Conclusão executiva" accent>
          <p className="text-[13px] text-strong leading-relaxed mb-3">{a.conclusao.participar}</p>
          <div className="grid grid-cols-2 gap-4">
            {a.conclusao.principaisVantagens?.length ? (
              <div>
                <div className="text-[11px] font-mono-custom text-emerald-400 uppercase tracking-wider mb-1.5">Vantagens</div>
                <Lista items={a.conclusao.principaisVantagens} />
              </div>
            ) : null}
            {a.conclusao.principaisRiscos?.length ? (
              <div>
                <div className="text-[11px] font-mono-custom text-amber-400 uppercase tracking-wider mb-1.5">Riscos</div>
                <Lista items={a.conclusao.principaisRiscos} />
              </div>
            ) : null}
          </div>
        </Bloco>
      )}

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

      {/* Análise legal (Lei 14.133) */}
      {a.analiseLegal?.length ? (
        <Bloco icon={Scale} title="Análise legal (Lei 14.133/2021)" warn>
          <Lista items={a.analiseLegal} />
        </Bloco>
      ) : null}

      {/* Riscos para o licitante */}
      {a.riscos?.length ? (
        <Bloco icon={AlertTriangle} title="Riscos para o licitante">
          <div className="space-y-2">
            {a.riscos.map((r, i) => (
              <div key={i} className="border border-subtle rounded-lg p-3 bg-bg3/40">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] text-strong leading-snug flex-1">{r.descricao}</span>
                  <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border flex-shrink-0 uppercase',
                    r.grau === 'alto' ? SEV_STYLE.alta : r.grau === 'medio' ? SEV_STYLE.media : SEV_STYLE.baixa)}>{r.grau}</span>
                </div>
                {r.mitigacao && <p className="text-[11px] text-faint leading-snug mt-1">Mitigação: {r.mitigacao}</p>}
              </div>
            ))}
          </div>
        </Bloco>
      ) : null}

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

      {/* Impugnação automática — o diferencial jurídico */}
      {a.impugnacao && (a.impugnacao.recomendada || (a.impugnacao.pontos?.length ?? 0) > 0) && (
        <Bloco icon={Gavel} title="Impugnação" warn>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={clsx('text-[10px] font-mono-custom px-2 py-0.5 rounded-full border uppercase',
              a.impugnacao.recomendada ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-bg4 text-faint border-subtle2')}>
              {a.impugnacao.recomendada ? 'Impugnação recomendada' : 'Impugnação não recomendada'}
            </span>
            {a.impugnacao.tipo && a.impugnacao.tipo !== 'nao' && <span className="text-[11px] text-muted">({a.impugnacao.tipo})</span>}
          </div>
          {a.impugnacao.estrategia && <p className="text-[12px] text-muted mb-3"><span className="text-faint">Estratégia:</span> {a.impugnacao.estrategia}</p>}
          {a.impugnacao.pontos?.length ? (
            <div className="space-y-2 mb-3">
              {a.impugnacao.pontos.map((p, i) => (
                <div key={i} className="border border-subtle rounded-lg p-3 bg-bg3/40">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] text-strong leading-snug flex-1">{p.ponto}</span>
                    <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border border-subtle2 text-faint uppercase flex-shrink-0 whitespace-nowrap">{p.relevancia} · êxito {p.probabilidadeExito}</span>
                  </div>
                  {p.fundamento && <p className="text-[11px] text-faint leading-snug mt-1">{p.fundamento}</p>}
                </div>
              ))}
            </div>
          ) : null}
          {a.impugnacao.minuta && <MinutaImpugnacao texto={a.impugnacao.minuta} />}
        </Bloco>
      )}

      <p className="text-[10px] text-faint font-mono-custom text-center pt-1">
        Análise gerada por IA — confira sempre contra o edital original antes de decidir.
      </p>
    </div>
  )
}

function MinutaImpugnacao({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">Minuta pronta para protocolo</span>
        <button
          onClick={() => navigator.clipboard.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) }).catch(() => {})}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
        >
          {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
        </button>
      </div>
      <pre className="text-[11px] text-muted leading-relaxed whitespace-pre-wrap bg-bg3/40 border border-subtle rounded-lg p-3 max-h-[380px] overflow-y-auto" style={{ fontFamily: 'inherit' }}>{texto}</pre>
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
