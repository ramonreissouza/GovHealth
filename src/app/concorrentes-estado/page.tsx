'use client'
// src/app/concorrentes-estado/page.tsx — TELA 4: Concorrentes por Estado e Equipamento
// Lê do banco via /api/resultados/concorrentes-estado (resultados homologados do PNCP).
// Multi-UF (puxa os estados do Setup), busca por nome e foco por empresa: ao selecionar
// um concorrente, o gráfico/itens/entidades passam a refletir só ele, com o nº do
// processo (PNCP) no detalhamento. "Voltar" tira o filtro da empresa.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Trophy, Building2, Database, Filter, Search, Package, ChevronDown, ArrowLeft, ExternalLink } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { formatBRL } from '@/lib/format'
import { CATEGORIAS } from '@/lib/categoria-mercado'
import { publishDataStatus } from '@/lib/data-status'
import { ExportButton } from '@/components/ui/ExportButton'
import { SetupFilterHint } from '@/components/ui/SetupFilterHint'
import type { ExportColumn } from '@/lib/export'
import { useSetupUFDefault } from '@/lib/use-setup-uf'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['todos', '2026', '2025', '2024', '2023']
const CORES = ['#00ff9d','#60a5fa','#f59e0b','#f87171','#c084fc','#4ade80','#22d3ee','#fb923c','#a78bfa','#34d399','#f472b6','#94a3b8','#fbbf24','#38bdf8']

interface ItemDist { item: string; valor: number; qtd: number; pct: number }
interface Entidade { entidade: string | null; valor: number; convenios: number }
interface CatCount { categoria: string; n: number; valor: number }
interface Top3 { vencedor: string | null; chave?: string | null; valor: number; item: string | null; convenios?: number }
interface Breakdown { processo: string | null; item: string; entidade: string | null; qtd: number | null; valor_unitario: number | null; valor_total: number | null }
interface ApiResponse {
  uf: string | null
  categoria: string | null
  fornecedor?: string | null
  top3: Top3[]
  concorrentes: Top3[]
  distribuicaoItens: ItemDist[]
  entidades: Entidade[]
  breakdown?: Breakdown[]
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

// URL pública do processo no portal do PNCP a partir do nº de controle. Cobre os dois
// formatos vistos no banco; se nenhum casar, devolve null (a UI mostra só o texto).
function pncpUrlFromControle(controle: string | null): string | null {
  if (!controle) return null
  // Formato A (oficial): {cnpj14}-{tipo}-{seq}/{ano}
  let m = controle.match(/^(\d{14})-\d+-(\d+)\/(\d{4})/)
  if (m) return `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${Number(m[2])}`
  // Formato B: {cnpj14}-{ano}-{seq}
  m = controle.match(/^(\d{14})-(\d{4})-(\d+)/)
  if (m) return `https://pncp.gov.br/app/editais/${m[1]}/${m[2]}/${Number(m[3])}`
  return null
}

export default function ConcorrentesEstadoPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  // Multi-UF: puxa TODOS os estados do Setup da Empresa (item 11).
  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const { marcarTocado: marcarUFTocado } = useSetupUFDefault((ufs) => setUfsAtivos(new Set(ufs)))
  const [ano, setAno] = useState('todos')
  const [itemFiltro, setItemFiltro] = useState<string | null>(null)
  const [catAtiva, setCatAtiva] = useState<string | null>(null)
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const [busca, setBusca] = useState('')
  const [buscaQuery, setBuscaQuery] = useState('') // debounced → servidor

  // Empresa em foco: filtra gráfico/itens/entidades/breakdown por ela (item 11).
  const [fornecedorSel, setFornecedorSel] = useState<{ nome: string; chave: string | null } | null>(null)

  const selecionarFornecedor = useCallback((nome: string | null, chave?: string | null) => {
    if (!nome) return
    setFornecedorSel({ nome, chave: chave ?? null })
    setItemFiltro(null)
  }, [])

  // Sequenciador de requisições: descarta respostas fora de ordem. Sem isso, a busca
  // inicial (sem os estados do Setup) chegava depois da filtrada e a sobrescrevia — o
  // filtro "se perdia" e só voltava no F5.
  const reqIdRef = useRef(0)
  const load = useCallback(async () => {
    const myId = ++reqIdRef.current
    setLoading(true); setErro(null)
    try {
      const params = new URLSearchParams()
      if (ufsAtivos.size > 0) params.set('uf', [...ufsAtivos].join(','))
      if (ano !== 'todos') params.set('ano', ano)
      if (itemFiltro) params.set('item', itemFiltro)
      if (catAtiva) params.set('categoria', catAtiva)
      if (buscaQuery) params.set('q', buscaQuery)
      if (fornecedorSel) {
        if (fornecedorSel.chave) params.set('chave', fornecedorSel.chave)
        else params.set('fornecedor', fornecedorSel.nome)
      }
      const res = await fetch(`/api/resultados/concorrentes-estado?${params}`)
      const json: ApiResponse = await res.json()
      if (myId !== reqIdRef.current) return // resposta obsoleta — ignora
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setData(null) }
      else { setData(json); publishDataStatus(json) }
    } catch (e) { if (myId === reqIdRef.current) { setErro({ msg: String(e) }); setData(null) } }
    finally { if (myId === reqIdRef.current) setLoading(false) }
  }, [ufsAtivos, ano, itemFiltro, catAtiva, buscaQuery, fornecedorSel])

  // Debounce dos filtros: junta cliques rápidos (UF/categoria) numa só query pesada.
  useEffect(() => { const t = setTimeout(() => { load() }, 250); return () => clearTimeout(t) }, [load])

  // debounce da busca por nome (server-side).
  useEffect(() => { const t = setTimeout(() => setBuscaQuery(busca.trim()), 350); return () => clearTimeout(t) }, [busca])

  const ufsComDados = new Set(data?.ufsComDados ?? [])
  const dist = data?.distribuicaoItens ?? []
  const concorrentes = data?.concorrentes ?? data?.top3 ?? []
  const top3 = concorrentes.slice(0, 3)
  const restantes = concorrentes.slice(3)
  const maxValor = concorrentes.length ? Math.max(...concorrentes.map((c) => c.valor || 0)) : 0
  const entidades = data?.entidades ?? []
  const breakdown = data?.breakdown ?? []
  const catMap = new Map((data?.categorias ?? []).map((c) => [c.categoria, c.n]))
  const escopoLabel = ufsAtivos.size === 0 ? 'Brasil (todos os estados)' : [...ufsAtivos].sort().join(', ')

  const toggleUf = (uf: string) => { marcarUFTocado(); setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s }); setItemFiltro(null) }

  const donutData = useMemo(() => dist.map((d, i) => ({ name: d.item, value: d.valor, pct: d.pct, fill: CORES[i % CORES.length] })), [dist])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Concorrentes por Estado"
          subtitle={loading ? 'Carregando…' : `${escopoLabel} · ${formatBRL(data?.valorTotal ?? 0)} homologados${fornecedorSel ? ' · ' + fornecedorSel.nome : ''}`} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Seletor de estado (multi — puxa os estados do Setup) */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">
              Estados {ufsAtivos.size > 0 && <span className="text-accent">· {ufsAtivos.size} selecionado{ufsAtivos.size !== 1 ? 's' : ''}</span>}
            </div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => { marcarUFTocado(); setUfsAtivos(new Set()); setItemFiltro(null) }}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                País todo
              </button>
              {UFS.map((u) => {
                const temDados = ufsComDados.has(u)
                const on = ufsAtivos.has(u)
                return (
                  <button key={u} onClick={() => toggleUf(u)}
                    title={temDados ? '' : 'Sem resultados no banco (rode o ETL para esta UF)'}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                      on ? 'bg-accent text-black font-bold'
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

          {/* Ano + busca + exportar */}
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
                placeholder="Buscar concorrente por nome…"
                className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
            </div>
            <div className="ml-auto">
              <ExportButton data={entidades} columns={COLS_ENTIDADES}
                filename={`govhealth-entidades-${escopoLabel.replace(/\W+/g, '-')}`} title={`Entidades beneficiadas — GovHealth AI`} />
            </div>
          </div>

          <SetupFilterHint estados className="mb-4" />

          {/* Banner de foco por empresa (item 11) */}
          {fornecedorSel && (
            <div className="flex items-center gap-3 bg-accent/10 border border-accent/30 rounded-xl px-4 py-2.5 mb-4">
              <Building2 size={14} className="text-accent flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">Filtrando por empresa</span>
                <div className="text-[13px] font-semibold text-strong truncate">{fornecedorSel.nome}</div>
              </div>
              <button onClick={() => { setFornecedorSel(null); setItemFiltro(null) }}
                className="ml-auto flex items-center gap-1.5 text-[11px] font-mono-custom px-3 py-1.5 rounded-lg bg-bg2 border border-subtle2 text-strong hover:border-accent hover:text-accent transition-all flex-shrink-0">
                <ArrowLeft size={12} /> Voltar
              </button>
            </div>
          )}

          {erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Database size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">{erro.msg}</div>
              {erro.instrucoes && <div className="text-[12px] text-muted font-mono-custom">{erro.instrucoes}</div>}
            </div>
          ) : (
            <>
              {/* Top 3 concorrentes — clique = filtrar a tela por essa empresa */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {top3.length === 0 && !loading ? (
                  <div className="col-span-3 bg-bg2 border border-subtle rounded-xl p-6 text-center text-faint text-[13px]">
                    Sem resultados para {escopoLabel}.
                  </div>
                ) : top3.map((t, i) => {
                  const ativo = !!fornecedorSel && (fornecedorSel.chave ? fornecedorSel.chave === t.chave : fornecedorSel.nome === t.vencedor)
                  return (
                    <button
                      key={i}
                      onClick={() => selecionarFornecedor(t.vencedor, t.chave)}
                      className={clsx('bg-bg2 border rounded-xl px-4 py-3 text-left transition-colors group',
                        ativo ? 'border-accent bg-bg3' : 'border-subtle hover:border-accent/40 hover:bg-bg3')}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Trophy size={13} className={clsx(i === 0 ? 'text-amber' : i === 1 ? 'text-faint' : 'text-[#cd7f32]')} />
                        <span className="text-[10px] font-mono-custom text-faint">#{i + 1} concorrente</span>
                        <span className="ml-auto text-[9px] font-mono-custom text-faint opacity-0 group-hover:opacity-100 transition-opacity">filtrar por esta →</span>
                      </div>
                      <div className="text-[13px] font-semibold text-strong leading-tight truncate group-hover:text-accent transition-colors">{t.vencedor ?? '—'}</div>
                      <div className="text-[16px] font-mono-custom font-bold text-accent mt-1">{formatBRL(t.valor)}</div>
                      <div className="text-[10px] text-faint truncate mt-0.5">{t.item ?? '—'}</div>
                    </button>
                  )
                })}
              </div>

              {/* Ranking completo de concorrentes (do 4º em diante) — expansível */}
              {restantes.length > 0 && (
                <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden mb-4">
                  <button
                    onClick={() => setMostrarTodos((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg3 transition-colors">
                    <span className="text-[11px] font-mono-custom text-strong flex items-center gap-1.5">
                      <Trophy size={12} className="text-faint" />
                      {mostrarTodos ? 'Ocultar' : 'Ver'} todos os {concorrentes.length} concorrentes
                      {itemFiltro && <span className="text-faint">· {itemFiltro}</span>}
                    </span>
                    <ChevronDown size={14} className={clsx('text-faint transition-transform', mostrarTodos && 'rotate-180')} />
                  </button>
                  {mostrarTodos && (
                    <div className="divide-y divide-subtle border-t border-subtle max-h-[60vh] overflow-y-auto">
                      {restantes.map((c, i) => {
                        const pct = maxValor > 0 ? (c.valor / maxValor) * 100 : 0
                        const ativo = !!fornecedorSel && (fornecedorSel.chave ? fornecedorSel.chave === c.chave : fornecedorSel.nome === c.vencedor)
                        return (
                          <button key={`${c.chave ?? c.vencedor}-${i}`} onClick={() => selecionarFornecedor(c.vencedor, c.chave)}
                            className={clsx('w-full text-left px-4 py-2 relative transition-colors group', ativo ? 'bg-bg3' : 'hover:bg-bg3')}>
                            <span className="absolute left-0 top-0 bottom-0 bg-accent/5" style={{ width: `${pct}%` }} />
                            <div className="relative flex items-center gap-3">
                              <span className="w-6 text-center text-[11px] font-mono-custom font-bold text-faint flex-shrink-0">{i + 4}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] text-strong truncate group-hover:text-accent transition-colors">{c.vencedor ?? '—'}</div>
                                <div className="text-[9px] font-mono-custom text-faint mt-0.5 truncate">
                                  {c.convenios != null && <>{c.convenios} licitaç{c.convenios !== 1 ? 'ões' : 'ão'} · </>}{c.item ?? '—'}
                                </div>
                              </div>
                              <div className="text-[12px] font-mono-custom font-bold text-accent flex-shrink-0">{formatBRL(c.valor)}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

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
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">
                    {fornecedorSel ? `Itens fornecidos por ${fornecedorSel.nome}` : 'Porcentagem de itens adquiridos'}
                  </div>
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
                  <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Building2 size={11} /> {fornecedorSel ? 'Quem comprou desta empresa' : 'Entidades beneficiadas'}
                  </div>
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

              {/* Detalhamento por processo (com nº PNCP) — só com empresa em foco (item 11) */}
              {fornecedorSel && (
                <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden mt-3">
                  <div className="px-4 py-2.5 border-b border-subtle bg-bg3/30 text-[10px] font-mono-custom text-faint uppercase tracking-wider flex items-center gap-1.5">
                    <Package size={12} /> Detalhamento por processo · {fornecedorSel.nome}
                  </div>
                  {breakdown.length === 0 ? (
                    <div className="p-6 text-center text-faint text-[12px]">{loading ? 'Carregando…' : 'Sem detalhamento para este concorrente no escopo atual.'}</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[520px]">
                      <table className="w-full">
                        <thead className="sticky top-0 bg-bg2">
                          <tr className="border-b border-subtle">
                            <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2">Nº processo (PNCP)</th>
                            <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Item</th>
                            <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Entidade</th>
                            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Qtd</th>
                            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Valor unit.</th>
                            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.map((b, i) => {
                            const url = pncpUrlFromControle(b.processo)
                            return (
                              <tr key={`${b.processo}-${i}`} className="border-b border-subtle/50 last:border-0 hover:bg-bg3/40">
                                <td className="px-4 py-2 text-[10px] font-mono-custom text-muted whitespace-nowrap">
                                  {url ? (
                                    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent transition-colors">
                                      {b.processo} <ExternalLink size={9} />
                                    </a>
                                  ) : (b.processo ?? '—')}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-strong max-w-[280px] truncate" title={b.item}>{b.item}</td>
                                <td className="px-3 py-2 text-[10px] text-muted max-w-[220px] truncate" title={b.entidade ?? undefined}>{b.entidade ?? '—'}</td>
                                <td className="px-3 py-2 text-right text-[10px] font-mono-custom text-muted whitespace-nowrap">{b.qtd != null ? b.qtd.toLocaleString('pt-BR') : '—'}</td>
                                <td className="px-3 py-2 text-right text-[10px] font-mono-custom text-muted whitespace-nowrap">{b.valor_unitario != null ? formatBRL(b.valor_unitario) : '—'}</td>
                                <td className="px-4 py-2 text-right text-[11px] font-mono-custom font-bold text-strong whitespace-nowrap">{formatBRL(b.valor_total)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
