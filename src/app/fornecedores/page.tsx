'use client'
// src/app/fornecedores/page.tsx — Ranking de Fornecedores (Vendedores)
// Maiores vendedores por categoria, no país todo ou por UFs selecionadas (multi).
// Ao clicar num fornecedor, mostra o que ele vendeu por estado, categoria e item.
// Lê /api/resultados/fornecedores (resultados homologados do PNCP via ETL).

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Search, Trophy, Database, MapPin, Boxes, Package, X } from 'lucide-react'
import { formatBRL } from '@/lib/format'
import { CATEGORIAS, CATEGORIA_LABEL } from '@/lib/categoria-mercado'
import { publishDataStatus } from '@/lib/data-status'
import { ExportButton } from '@/components/ui/ExportButton'
import type { ExportColumn } from '@/lib/export'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['todos', '2026', '2025', '2024', '2023']

interface Ranking { fornecedor: string | null; cnpj: string | null; valor: number; itens: number; convenios: number; ufs: number }
interface CatCount { categoria: string; n: number; valor: number }
interface PorRow { chave: string | null; valor: number; qtd: number }
interface PorCat { categoria: string; valor: number; qtd: number }
interface PorItem { item: string; codigo_catmat: string | null; valor: number; qtd: number }
interface Detalhe { fornecedor: string; porEstado: PorRow[]; porCategoria: PorCat[]; porItem: PorItem[] }
interface ApiResponse {
  escopo: string
  categoria: string | null
  kpis: { valorTotal: number; fornecedores: number; itens: number; convenios: number }
  ranking: Ranking[]
  categorias?: CatCount[]
  ufsComDados: string[]
  detalhe: Detalhe | null
  atualizadoEm?: string
  fonte?: string
  error?: string
  instrucoes?: string
}

const COLS_EXPORT: ExportColumn<Ranking>[] = [
  { key: 'fornecedor', label: 'Fornecedor' },
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'valor', label: 'Valor homologado (R$)' },
  { key: 'itens', label: 'Itens únicos' },
  { key: 'convenios', label: 'Convênios' },
  { key: 'ufs', label: 'UFs de atuação' },
]

export default function FornecedoresPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [ano, setAno] = useState('2026') // default leve: evita varrer a base inteira no 1º load
  const [catAtiva, setCatAtiva] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [buscaQuery, setBuscaQuery] = useState('') // debounced → enviado ao servidor

  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [det, setDet] = useState<Detalhe | null>(null)
  const [detLoading, setDetLoading] = useState(false)

  const filtrosParams = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' })
    if (ufsAtivos.size > 0) params.set('uf', [...ufsAtivos].join(','))
    if (ano !== 'todos') params.set('ano', ano)
    if (catAtiva) params.set('categoria', catAtiva)
    return params
  }, [ufsAtivos, ano, catAtiva])

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const params = filtrosParams()
      if (buscaQuery) params.set('q', buscaQuery)
      const res = await fetch(`/api/resultados/fornecedores?${params}`)
      const json: ApiResponse = await res.json()
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setData(null) }
      else { setData(json); publishDataStatus(json) }
    } catch (e) { setErro({ msg: String(e) }); setData(null) }
    finally { setLoading(false) }
  }, [filtrosParams, buscaQuery])

  useEffect(() => { load() }, [load])

  // debounce da busca por nome (server-side): acha qualquer fornecedor, não só o top 100.
  useEffect(() => { const t = setTimeout(() => setBuscaQuery(busca.trim()), 350); return () => clearTimeout(t) }, [busca])

  // Drill-down do fornecedor selecionado (respeita UF/ano; ignora categoria no back).
  useEffect(() => {
    if (!selecionado) { setDet(null); return }
    let vivo = true
    setDetLoading(true)
    const params = filtrosParams()
    params.set('fornecedor', selecionado)
    params.set('limit', '1')
    fetch(`/api/resultados/fornecedores?${params}`)
      .then(async (r) => { const j: ApiResponse = await r.json(); if (vivo) setDet(j.detalhe) })
      .catch(() => { if (vivo) setDet(null) })
      .finally(() => { if (vivo) setDetLoading(false) })
    return () => { vivo = false }
  }, [selecionado, filtrosParams])

  const kpis = data?.kpis
  const ranking = data?.ranking ?? []
  const catMap = new Map((data?.categorias ?? []).map((c) => [c.categoria, c.n]))
  const maxValor = ranking.length ? Math.max(...ranking.map((r) => r.valor || 0)) : 0
  const escopoLabel = ufsAtivos.size === 0 ? 'Brasil (todos os estados)' : [...ufsAtivos].sort().join(', ')

  const toggleUf = (uf: string) => setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })

  const KPI_CARDS = [
    { label: 'Valor total homologado', value: kpis ? formatBRL(kpis.valorTotal) : '—' },
    { label: 'Fornecedores', value: kpis ? String(kpis.fornecedores) : '—' },
    { label: 'Itens únicos', value: kpis ? String(kpis.itens) : '—' },
    { label: 'Convênios', value: kpis ? String(kpis.convenios) : '—' },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Ranking de Fornecedores"
          subtitle={loading ? 'Carregando…' : `${escopoLabel}${catAtiva ? ' · ' + (CATEGORIA_LABEL[catAtiva] ?? catAtiva) : ''}`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {KPI_CARDS.map(({ label, value }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className="text-[18px] font-mono-custom font-bold text-strong mt-0.5 leading-tight">{value}</div>
              </div>
            ))}
          </div>

          {/* Estados (multiseleção) */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">
              Estados {ufsAtivos.size > 0 && <span className="text-accent">· {ufsAtivos.size} selecionado{ufsAtivos.size !== 1 ? 's' : ''}</span>}
            </div>
            <div className="flex gap-1 flex-wrap items-center">
              <button onClick={() => setUfsAtivos(new Set())}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                País todo
              </button>
              {UFS.map((uf) => (
                <button key={uf} onClick={() => toggleUf(uf)}
                  className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                    ufsAtivos.has(uf) ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                  {uf}
                </button>
              ))}
            </div>
          </div>

          {/* Categoria */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Categoria</div>
            <div className="flex gap-1 flex-wrap items-center">
              <button onClick={() => setCatAtiva(null)}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  catAtiva === null ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todas
              </button>
              {CATEGORIAS.map(({ key, label }) => {
                const n = catMap.get(key)
                return (
                  <button key={key} onClick={() => setCatAtiva((p) => (p === key ? null : key))}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all flex items-center gap-1',
                      catAtiva === key ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                    {label}
                    {n != null && <span className={clsx('text-[9px]', catAtiva === key ? 'text-black/60' : 'text-faint')}>{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Ano + busca */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1 w-fit">
              {ANOS.map((a) => (
                <button key={a} onClick={() => setAno(a)}
                  className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                    ano === a ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                  {a === 'todos' ? 'Todos anos' : a}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-bg2 border border-subtle2 rounded-lg px-3 py-2 flex-1 max-w-xs">
              <Search size={13} className="text-faint flex-shrink-0" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar fornecedor por nome…"
                className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
            </div>
            <div className="ml-auto">
              <ExportButton data={ranking} columns={COLS_EXPORT} filename="govhealth-fornecedores" title="Ranking de Fornecedores — GovHealth AI" />
            </div>
          </div>

          {erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Database size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">{erro.msg}</div>
              {erro.instrucoes && <div className="text-[12px] text-muted font-mono-custom">{erro.instrucoes}</div>}
            </div>
          ) : (
            <div className={clsx('grid gap-3', selecionado ? 'grid-cols-[1fr_400px]' : 'grid-cols-1')}>
              {/* Ranking */}
              <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden self-start">
                <div className="px-4 py-2.5 border-b border-subtle bg-bg3/30 text-[10px] font-mono-custom text-faint uppercase tracking-wider">
                  Maiores vendedores {catAtiva ? `· ${CATEGORIA_LABEL[catAtiva] ?? catAtiva}` : '· todas categorias'}
                </div>
                {loading ? (
                  <div className="p-10 text-center text-faint text-[13px]">Carregando ranking…</div>
                ) : ranking.length === 0 ? (
                  <div className="p-10 text-center text-faint text-[13px]">
                    {buscaQuery ? `Nenhum fornecedor encontrado para “${buscaQuery}” com os filtros atuais.` : 'Nenhum fornecedor com os filtros atuais.'}
                  </div>
                ) : (
                  <div className="divide-y divide-subtle">
                    {ranking.map((r, i) => {
                      const ativo = selecionado === r.fornecedor
                      const pct = maxValor > 0 ? (r.valor / maxValor) * 100 : 0
                      return (
                        <button key={`${r.fornecedor}-${i}`}
                          onClick={() => setSelecionado(ativo ? null : r.fornecedor)}
                          className={clsx('w-full text-left px-4 py-2.5 transition-colors relative', ativo ? 'bg-bg3' : 'hover:bg-bg3')}>
                          <span className="absolute left-0 top-0 bottom-0 bg-accent/5" style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center gap-3">
                            <span className={clsx('w-6 text-center text-[11px] font-mono-custom font-bold flex-shrink-0',
                              i === 0 ? 'text-amber' : i < 3 ? 'text-strong' : 'text-faint')}>{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[12px] text-strong truncate">
                                {i === 0 && <Trophy size={11} className="text-amber flex-shrink-0" />}
                                {r.fornecedor ?? '—'}
                              </div>
                              <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                                {r.cnpj ?? '—'} · {r.itens} item{r.itens !== 1 ? 's' : ''} · {r.convenios} convênio{r.convenios !== 1 ? 's' : ''} · {r.ufs} UF{r.ufs !== 1 ? 's' : ''}
                              </div>
                            </div>
                            <div className="text-[13px] font-mono-custom font-bold text-accent flex-shrink-0">{formatBRL(r.valor)}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Drill-down do fornecedor */}
              {selecionado && (
                <div className="bg-bg2 border border-subtle rounded-xl p-4 self-start sticky top-0">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider">Fornecedor</div>
                      <div className="text-[14px] font-semibold text-strong leading-tight">{selecionado}</div>
                    </div>
                    <button onClick={() => setSelecionado(null)} className="text-faint hover:text-strong flex-shrink-0"><X size={15} /></button>
                  </div>

                  {detLoading ? (
                    <div className="text-[12px] text-faint py-4">Carregando composição de vendas…</div>
                  ) : !det ? (
                    <div className="text-[12px] text-faint py-4">Sem dados para este fornecedor.</div>
                  ) : (
                    <div className="space-y-4">
                      <BarSection icon={<MapPin size={12} className="text-accent" />} titulo="Vendas por estado" linhas={det.porEstado.map((e) => ({ label: e.chave ?? '—', valor: e.valor }))} />
                      <BarSection icon={<Boxes size={12} className="text-accent" />} titulo="Vendas por categoria"
                        linhas={det.porCategoria.map((c) => ({ label: CATEGORIA_LABEL[c.categoria] ?? c.categoria, valor: c.valor }))} />
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Package size={12} className="text-accent" />
                          <span className="text-[10px] font-mono-custom uppercase tracking-wider text-faint">Principais itens vendidos</span>
                        </div>
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          {det.porItem.map((it, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 rounded px-2 py-1 bg-bg3/40">
                              <div className="text-[11px] text-strong truncate">
                                {it.codigo_catmat ? <span className="font-mono-custom text-faint">{it.codigo_catmat} · </span> : null}{it.item}
                              </div>
                              <div className="text-[11px] font-mono-custom font-bold text-strong flex-shrink-0">{formatBRL(it.valor)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

// Mini-gráfico de barras horizontais proporcionais.
function BarSection({ icon, titulo, linhas }: { icon: React.ReactNode; titulo: string; linhas: { label: string; valor: number }[] }) {
  const max = linhas.length ? Math.max(...linhas.map((l) => l.valor || 0)) : 0
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-mono-custom uppercase tracking-wider text-faint">{titulo}</span>
      </div>
      {linhas.length === 0 ? (
        <div className="text-[11px] text-faint">Sem dados.</div>
      ) : (
        <div className="space-y-1">
          {linhas.slice(0, 8).map((l, i) => (
            <div key={i} className="relative rounded bg-bg3/40 overflow-hidden">
              <span className="absolute left-0 top-0 bottom-0 bg-accent/15" style={{ width: `${max > 0 ? (l.valor / max) * 100 : 0}%` }} />
              <div className="relative flex items-center justify-between gap-2 px-2 py-1">
                <span className="text-[11px] text-strong truncate">{l.label}</span>
                <span className="text-[10px] font-mono-custom text-muted flex-shrink-0">{formatBRL(l.valor)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
