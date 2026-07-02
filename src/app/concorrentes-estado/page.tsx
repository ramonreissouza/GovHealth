'use client'
// src/app/concorrentes-estado/page.tsx — TELA 4: Concorrentes por Estado e Equipamento
// Lê do banco via /api/resultados/concorrentes-estado (resultados homologados do PNCP).

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Trophy, Building2, Database, Filter, X, Loader2, MapPin, Package } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { formatBRL } from '@/lib/format'
import { CATEGORIAS } from '@/lib/categoria-mercado'
import { publishDataStatus } from '@/lib/data-status'
import { ExportButton } from '@/components/ui/ExportButton'
import type { ExportColumn } from '@/lib/export'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['todos', '2026', '2025', '2024', '2023']
const CORES = ['#00ff9d','#60a5fa','#f59e0b','#f87171','#c084fc','#4ade80','#22d3ee','#fb923c','#a78bfa','#34d399','#f472b6','#94a3b8','#fbbf24','#38bdf8']

interface PorRow { chave: string | null; valor: number; qtd: number }
interface PorCatRow { categoria: string; valor: number; qtd: number }
interface PorItemRow { item: string; codigo_catmat: string | null; valor: number; qtd: number }
interface Top3 { vencedor: string | null; valor: number; item: string | null }
interface ItemDist { item: string; valor: number; qtd: number; pct: number }
interface Entidade { entidade: string | null; valor: number; convenios: number }
interface CatCount { categoria: string; n: number; valor: number }
interface ApiResponse {
  uf: string | null
  categoria: string | null
  top3: Top3[]
  distribuicaoItens: ItemDist[]
  entidades: Entidade[]
  ufsComDados: string[]
  categorias?: CatCount[]
  valorTotal: number
  atualizadoEm?: string
  fonte?: string
  error?: string
  instrucoes?: string
}

const COLS_ENTIDADES: ExportColumn<Entidade>[] = [
  { key: 'entidade', label: 'Entidade beneficiada' },
  { key: 'valor', label: 'Valor homologado (R$)' },
  { key: 'convenios', label: 'Convênios' },
]

export default function ConcorrentesEstadoPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [uf, setUf] = useState<string>('CE')
  const [ano, setAno] = useState('todos')
  const [itemFiltro, setItemFiltro] = useState<string | null>(null)
  const [catAtiva, setCatAtiva] = useState<string | null>(null)

  // Drill-down de um concorrente (T18): histórico por estado/categoria/item.
  const [drill, setDrill] = useState<string | null>(null)
  const [drillData, setDrillData] = useState<{ porEstado: PorRow[]; porCategoria: PorCatRow[]; porItem: PorItemRow[] } | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)

  const abrirDrill = useCallback((nome: string | null) => {
    if (!nome) return
    setDrill(nome); setDrillData(null); setDrillLoading(true)
    const p = new URLSearchParams({ fornecedor: nome })
    if (ano !== 'todos') p.set('ano', ano)
    fetch(`/api/resultados/fornecedores?${p}`)
      .then((r) => r.json())
      .then((d) => setDrillData(d.detalhe ?? null))
      .catch(() => {})
      .finally(() => setDrillLoading(false))
  }, [ano])

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const params = new URLSearchParams({ uf })
      if (ano !== 'todos') params.set('ano', ano)
      if (itemFiltro) params.set('item', itemFiltro)
      if (catAtiva) params.set('categoria', catAtiva)
      const res = await fetch(`/api/resultados/concorrentes-estado?${params}`)
      const json: ApiResponse = await res.json()
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setData(null) }
      else { setData(json); publishDataStatus(json) }
    } catch (e) { setErro({ msg: String(e) }); setData(null) }
    finally { setLoading(false) }
  }, [uf, ano, itemFiltro, catAtiva])

  useEffect(() => { load() }, [load])

  const ufsComDados = new Set(data?.ufsComDados ?? [])
  const dist = data?.distribuicaoItens ?? []
  const top3 = data?.top3 ?? []
  const entidades = data?.entidades ?? []
  const catMap = new Map((data?.categorias ?? []).map((c) => [c.categoria, c.n]))

  const donutData = useMemo(() => dist.map((d, i) => ({ name: d.item, value: d.valor, pct: d.pct, fill: CORES[i % CORES.length] })), [dist])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Concorrentes por Estado" subtitle={loading ? 'Carregando…' : `${uf} · ${formatBRL(data?.valorTotal ?? 0)} homologados`} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Seletor de estado */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Estado</div>
            <div className="flex gap-1 flex-wrap">
              {UFS.map((u) => {
                const temDados = ufsComDados.has(u)
                return (
                  <button key={u} onClick={() => { setUf(u); setItemFiltro(null) }}
                    title={temDados ? '' : 'Sem resultados no banco (rode o ETL para esta UF)'}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                      uf === u ? 'bg-accent text-black font-bold'
                        : temDados ? 'text-strong hover:bg-bg3 ring-1 ring-accent/30' : 'text-faint/50 hover:text-muted')}>
                    {u}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Categoria de mercado */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Categoria</div>
            <div className="flex gap-1 flex-wrap items-center">
              <button onClick={() => { setCatAtiva(null); setItemFiltro(null) }}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  catAtiva === null ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todas
              </button>
              {CATEGORIAS.map(({ key, label }) => {
                const n = catMap.get(key)
                return (
                  <button key={key} onClick={() => { setCatAtiva((p) => (p === key ? null : key)); setItemFiltro(null) }}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all flex items-center gap-1',
                      catAtiva === key ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                    {label}
                    {n != null && <span className={clsx('text-[9px]', catAtiva === key ? 'text-black/60' : 'text-faint')}>{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Ano + exportar */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1 w-fit">
            {ANOS.map((a) => (
              <button key={a} onClick={() => setAno(a)}
                className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                  ano === a ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                {a === 'todos' ? 'Todos anos' : a}
              </button>
            ))}
          </div>
            <ExportButton data={entidades} columns={COLS_ENTIDADES}
              filename={`govhealth-entidades-${uf}`} title={`Entidades beneficiadas ${uf} — GovHealth AI`} />
          </div>

          {erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Database size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">{erro.msg}</div>
              {erro.instrucoes && <div className="text-[12px] text-muted font-mono-custom">{erro.instrucoes}</div>}
            </div>
          ) : (
            <>
              {/* Top 3 concorrentes */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {top3.length === 0 && !loading ? (
                  <div className="col-span-3 bg-bg2 border border-subtle rounded-xl p-6 text-center text-faint text-[13px]">
                    Sem resultados para {uf}. Rode <span className="font-mono-custom">npm run etl -- --uf={uf}</span>.
                  </div>
                ) : top3.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => abrirDrill(t.vencedor)}
                    className="bg-bg2 border border-subtle rounded-xl px-4 py-3 text-left hover:border-accent/40 hover:bg-bg3 transition-colors group"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Trophy size={13} className={clsx(i === 0 ? 'text-amber' : i === 1 ? 'text-faint' : 'text-[#cd7f32]')} />
                      <span className="text-[10px] font-mono-custom text-faint">#{i + 1} concorrente</span>
                      <span className="ml-auto text-[9px] font-mono-custom text-faint opacity-0 group-hover:opacity-100 transition-opacity">ver perfil →</span>
                    </div>
                    <div className="text-[13px] font-semibold text-strong leading-tight truncate group-hover:text-accent transition-colors">{t.vencedor ?? '—'}</div>
                    <div className="text-[16px] font-mono-custom font-bold text-accent mt-1">{formatBRL(t.valor)}</div>
                    <div className="text-[10px] text-faint truncate mt-0.5">{t.item ?? '—'}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-[260px_1fr_300px] gap-3">
                {/* Esquerda: filtro por item */}
                <div className="bg-bg2 border border-subtle rounded-xl p-3">
                  <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5"><Filter size={11} /> Itens</div>
                  <div className="space-y-0.5 max-h-[440px] overflow-y-auto">
                    <button onClick={() => setItemFiltro(null)}
                      className={clsx('w-full text-left text-[11px] px-2 py-1.5 rounded-md transition-all',
                        itemFiltro === null ? 'bg-accent/15 text-accent' : 'text-muted hover:text-strong hover:bg-bg3')}>
                      Todos os itens
                    </button>
                    {dist.map((d, i) => (
                      <button key={d.item} onClick={() => setItemFiltro(itemFiltro === d.item ? null : d.item)}
                        className={clsx('w-full flex items-center justify-between gap-2 text-left text-[11px] px-2 py-1.5 rounded-md transition-all',
                          itemFiltro === d.item ? 'bg-accent/15 text-accent' : 'text-muted hover:text-strong hover:bg-bg3')}>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CORES[i % CORES.length] }} />
                          <span className="truncate">{d.item}</span>
                        </span>
                        <span className="font-mono-custom text-faint flex-shrink-0">{d.pct}%</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Centro: donut */}
                <div className="bg-bg2 border border-subtle rounded-xl p-4">
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Porcentagem de itens adquiridos</div>
                  {donutData.length === 0 ? (
                    <div className="h-[360px] flex items-center justify-center text-faint text-[13px]">{loading ? 'Carregando…' : 'Sem dados'}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={360}>
                      <PieChart>
                        <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={70} outerRadius={130} paddingAngle={1}>
                          {donutData.map((d, i) => <Cell key={i} fill={d.fill} stroke="#0a0a12" strokeWidth={1} />)}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: '#15151f', border: '1px solid #2a2a3a', borderRadius: 8, fontSize: 12 }}
                          formatter={(v) => formatBRL(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Direita: entidades beneficiadas */}
                <div className="bg-bg2 border border-subtle rounded-xl p-3">
                  <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5"><Building2 size={11} /> Entidades beneficiadas</div>
                  <div className="space-y-1 max-h-[440px] overflow-y-auto">
                    {entidades.length === 0 ? (
                      <div className="text-[11px] text-faint py-2">{loading ? 'Carregando…' : 'Sem entidades'}</div>
                    ) : entidades.map((e, i) => (
                      <div key={i} className="px-2 py-1.5 rounded-md hover:bg-bg3">
                        <div className="text-[11px] text-strong leading-snug line-clamp-2">{e.entidade ?? '—'}</div>
                        <div className="flex items-center gap-2 text-[10px] font-mono-custom text-faint mt-0.5">
                          <span className="text-accent">{formatBRL(e.valor)}</span>
                          <span>· {e.convenios} convênio{e.convenios !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Drill-down do concorrente (T18) */}
      {drill && (
        <div className="fixed inset-0 z-40" onClick={() => setDrill(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-[460px] bg-bg2 border-l border-subtle shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-bg2 border-b border-subtle px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">Perfil do concorrente</div>
                <h2 className="font-heading font-bold text-[15px] text-strong mt-1 leading-tight">{drill}</h2>
              </div>
              <button onClick={() => setDrill(null)} className="text-faint hover:text-strong transition-colors flex-shrink-0"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-5">
              {drillLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-faint py-8 justify-center"><Loader2 size={14} className="animate-spin" /> Carregando histórico…</div>
              ) : !drillData ? (
                <p className="text-[12px] text-muted py-4">Sem histórico detalhado para este concorrente.</p>
              ) : (
                <>
                  <div className="bg-bg3 border border-subtle rounded-lg p-3">
                    <div className="text-[10px] font-mono-custom text-faint uppercase">Total homologado{ano !== 'todos' ? ` (${ano})` : ''}</div>
                    <div className="text-[18px] font-mono-custom font-bold text-accent">{formatBRL(drillData.porEstado.reduce((s, r) => s + r.valor, 0))}</div>
                    <div className="text-[10px] text-faint">{drillData.porEstado.length} estado(s) · {drillData.porItem.length} item(ns)</div>
                  </div>

                  <DrillBloco titulo="Onde vende (estados)" icon={<MapPin size={12} className="text-accent" />}
                    linhas={drillData.porEstado.slice(0, 10).map((r) => ({ rotulo: r.chave ?? '—', valor: r.valor, qtd: r.qtd }))} />
                  <DrillBloco titulo="O que vende (categorias)" icon={<Package size={12} className="text-accent" />}
                    linhas={drillData.porCategoria.slice(0, 8).map((r) => ({ rotulo: r.categoria, valor: r.valor, qtd: r.qtd }))} />
                  <DrillBloco titulo="Principais itens" icon={<Trophy size={12} className="text-accent" />}
                    linhas={drillData.porItem.slice(0, 10).map((r) => ({ rotulo: r.item, valor: r.valor, qtd: r.qtd }))} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DrillBloco({ titulo, icon, linhas }: { titulo: string; icon: React.ReactNode; linhas: { rotulo: string; valor: number; qtd: number }[] }) {
  if (linhas.length === 0) return null
  const max = Math.max(...linhas.map((l) => l.valor), 1)
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">{icon}<span className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{titulo}</span></div>
      <div className="space-y-1.5">
        {linhas.map((l, i) => (
          <div key={i}>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-strong truncate">{l.rotulo}</span>
              <span className="font-mono-custom text-accent flex-shrink-0">{formatBRL(l.valor)}</span>
            </div>
            <div className="h-1 bg-bg4 rounded-full overflow-hidden mt-0.5">
              <div className="h-full bg-accent/50 rounded-full" style={{ width: `${(l.valor / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
