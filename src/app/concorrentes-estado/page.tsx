'use client'
// src/app/concorrentes-estado/page.tsx — TELA 4: Concorrentes por Estado e Equipamento
// Lê do banco via /api/resultados/concorrentes-estado (resultados homologados do PNCP).

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Trophy, Building2, Database, Filter } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { formatBRL } from '@/lib/format'
import { CATEGORIAS } from '@/lib/categoria-mercado'
import { publishDataStatus } from '@/lib/data-status'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['todos', '2026', '2025', '2024', '2023']
const CORES = ['#00ff9d','#60a5fa','#f59e0b','#f87171','#c084fc','#4ade80','#22d3ee','#fb923c','#a78bfa','#34d399','#f472b6','#94a3b8','#fbbf24','#38bdf8']

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

export default function ConcorrentesEstadoPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [uf, setUf] = useState<string>('CE')
  const [ano, setAno] = useState('todos')
  const [itemFiltro, setItemFiltro] = useState<string | null>(null)
  const [catAtiva, setCatAtiva] = useState<string | null>(null)

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

          {/* Ano */}
          <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1 mb-4 w-fit">
            {ANOS.map((a) => (
              <button key={a} onClick={() => setAno(a)}
                className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                  ano === a ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                {a === 'todos' ? 'Todos anos' : a}
              </button>
            ))}
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
                  <div key={i} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Trophy size={13} className={clsx(i === 0 ? 'text-amber' : i === 1 ? 'text-faint' : 'text-[#cd7f32]')} />
                      <span className="text-[10px] font-mono-custom text-faint">#{i + 1} concorrente</span>
                    </div>
                    <div className="text-[13px] font-semibold text-strong leading-tight truncate">{t.vencedor ?? '—'}</div>
                    <div className="text-[16px] font-mono-custom font-bold text-accent mt-1">{formatBRL(t.valor)}</div>
                    <div className="text-[10px] text-faint truncate mt-0.5">{t.item ?? '—'}</div>
                  </div>
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
    </div>
  )
}
