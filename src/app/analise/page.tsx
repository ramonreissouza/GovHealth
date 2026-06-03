'use client'
// src/app/analise/page.tsx — Maior Atuação (referencia2)

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { X, Search, ExternalLink, ChevronDown, ChevronUp, Package } from 'lucide-react'
import type { LicitacaoEnriquecida } from '@/app/api/licitacoes/route'
import type { ItemPNCP } from '@/lib/pncp'
import { PrecosReferencia } from '@/components/ui/PrecosReferencia'
import { CATEGORIA_LABEL as CAT_LABEL, CATEGORIA_COLOR as CAT_COLOR } from '@/lib/categorias'
import { formatBRL } from '@/lib/format'

// ── Constants ────────────────────────────────────────────────────────────────

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['2023','2024','2025']

const SITUACAO_CLASS: Record<number, string> = {
  1: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  2: 'bg-amber/15 text-amber border border-amber/30',
  3: 'bg-red/15 text-red border border-red/30',
  4: 'bg-bg4 text-faint border border-subtle2',
}


// ── Component ─────────────────────────────────────────────────────────────────

interface ApiResponse {
  licitacoes: LicitacaoEnriquecida[]
  kpis: { total: number; valorTotal: number; ticketMedio: number }
  porCategoria: Record<string, { count: number; valor: number }>
  topProponentes: { cnpj: string; proponente: string; uf: string; municipio: string; valor: number; count: number }[]
}

export default function AnalisePage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  // Row expand + item loading
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [itensCache, setItensCache] = useState<Record<string, ItemPNCP[]>>({})
  const [itensLoading, setItensLoading] = useState(false)

  const toggleRow = async (l: LicitacaoEnriquecida) => {
    if (expandedId === l.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(l.id)
    if (itensCache[l.id] || !l.cnpj || !l.anoCompra || !l.sequencialCompra) return
    setItensLoading(true)
    try {
      const res = await fetch(`/api/itens?cnpj=${l.cnpj}&ano=${l.anoCompra}&seq=${l.sequencialCompra}`)
      const json = await res.json()
      setItensCache((prev) => ({ ...prev, [l.id]: json.itens ?? [] }))
    } catch {
      setItensCache((prev) => ({ ...prev, [l.id]: [] }))
    } finally {
      setItensLoading(false)
    }
  }

  // Filters
  const [anosAtivos, setAnosAtivos] = useState<Set<string>>(new Set(['2024', '2025']))
  const [categoriasAtivas, setCategoriasAtivas] = useState<Set<string>>(new Set())
  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [situacao, setSituacao] = useState('todos')
  const [queryProponente, setQueryProponente] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/licitacoes?limit=500')
      setData(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const all = data?.licitacoes ?? []

  // Client-side filtering
  const filtered = all.filter((l) => {
    if (anosAtivos.size > 0 && !anosAtivos.has(l.ano)) return false
    if (categoriasAtivas.size > 0 && !categoriasAtivas.has(l.categoria)) return false
    if (ufsAtivos.size > 0 && !ufsAtivos.has(l.uf)) return false
    if (situacao === 'aberto' && l.situacaoId !== 1) return false
    if (situacao === 'encerrado' && l.situacaoId === 1) return false
    if (queryProponente && !l.proponente.toLowerCase().includes(queryProponente.toLowerCase())) return false
    return true
  })

  const valorTotal = filtered.reduce((s, l) => s + l.valor, 0)

  // Active filter chips
  const chips = [
    ...[...categoriasAtivas].map((c) => ({ label: CAT_LABEL[c] ?? c, remove: () => setCategoriasAtivas((p) => { const s = new Set(p); s.delete(c); return s }) })),
    ...[...ufsAtivos].map((u) => ({ label: u, remove: () => setUfsAtivos((p) => { const s = new Set(p); s.delete(u); return s }) })),
    ...(situacao !== 'todos' ? [{ label: situacao === 'aberto' ? 'Em Aberto' : 'Encerrado', remove: () => setSituacao('todos') }] : []),
  ]

  // Proponentes from filtered set for sidebar list
  const proponentesFiltrados = [...new Map(
    filtered.map((l) => [l.cnpj, { proponente: l.proponente, valor: filtered.filter((x) => x.cnpj === l.cnpj).reduce((s, x) => s + x.valor, 0) }])
  ).entries()]
    .sort((a, b) => b[1].valor - a[1].valor)
    .slice(0, 25)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Maior Atuação" subtitle={loading ? 'Carregando…' : `${filtered.length} licitações · ${formatBRL(valorTotal)}`} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Active chips */}
          {chips.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap items-center">
              {chips.map(({ label, remove }) => (
                <button key={label} onClick={remove}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom px-2.5 py-1 bg-accent/10 border border-accent/30 text-accent rounded-full">
                  {label} <X size={10} />
                </button>
              ))}
              <button onClick={() => { setCategoriasAtivas(new Set()); setUfsAtivos(new Set()); setSituacao('todos') }}
                className="text-[11px] font-mono-custom text-faint hover:text-strong">
                Limpar filtros
              </button>
            </div>
          )}

          <div className="flex gap-4">

            {/* ── Left panel ──────────────────────────────────────────────── */}
            <div className="w-52 flex-shrink-0 space-y-3">

              {/* Total */}
              <div className="bg-bg2 border border-subtle rounded-xl p-4">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-1">Valor Total Homologado</div>
                <div className="text-[22px] font-mono-custom font-bold text-strong leading-tight">{formatBRL(valorTotal)}</div>
                <div className="text-[10px] font-mono-custom text-faint mt-1">{filtered.length} licitações</div>
              </div>

              {/* Year */}
              <div className="bg-bg2 border border-subtle rounded-xl p-3">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Ano</div>
                <div className="flex gap-1">
                  {ANOS.map((ano) => (
                    <button key={ano}
                      onClick={() => setAnosAtivos((p) => { const s = new Set(p); s.has(ano) ? s.delete(ano) : s.add(ano); return s })}
                      className={clsx('flex-1 text-[11px] font-mono-custom py-1.5 rounded-md transition-all',
                        anosAtivos.has(ano) ? 'bg-accent text-black font-bold' : 'bg-bg3 text-muted hover:text-strong')}>
                      {ano}
                    </button>
                  ))}
                </div>
              </div>

              {/* Equipamentos */}
              <div className="bg-bg2 border border-subtle rounded-xl p-3">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Equipamentos</div>
                <div className="space-y-1">
                  {Object.entries(CAT_LABEL).map(([key, label]) => {
                    const count = all.filter((l) => l.categoria === key && (anosAtivos.size === 0 || anosAtivos.has(l.ano))).length
                    if (count === 0) return null
                    return (
                      <button key={key}
                        onClick={() => setCategoriasAtivas((p) => { const s = new Set(p); s.has(key) ? s.delete(key) : s.add(key); return s })}
                        className={clsx('w-full flex items-center justify-between px-2 py-1.5 rounded-md transition-all text-left',
                          categoriasAtivas.has(key) ? 'bg-accent/15 border border-accent/30' : 'hover:bg-bg3')}>
                        <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', CAT_COLOR[key])}>
                          {label}
                        </span>
                        <span className="text-[10px] font-mono-custom text-faint">{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Situação */}
              <div className="bg-bg2 border border-subtle rounded-xl p-3">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Situação do Aceite</div>
                {[{ k: 'todos', l: 'Todos' }, { k: 'aberto', l: 'Em Aberto' }, { k: 'encerrado', l: 'Encerrado' }].map(({ k, l }) => (
                  <button key={k} onClick={() => setSituacao(k)}
                    className={clsx('w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-all',
                      situacao === k ? 'bg-accent/15 text-accent' : 'text-muted hover:text-strong hover:bg-bg3')}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Nome do Proponente */}
              <div className="bg-bg2 border border-subtle rounded-xl p-3">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Nome do Proponente</div>
                <div className="flex items-center gap-1.5 bg-bg3 border border-subtle2 rounded-lg px-2 py-1.5 mb-2">
                  <Search size={11} className="text-faint" />
                  <input value={queryProponente} onChange={(e) => setQueryProponente(e.target.value)}
                    placeholder="Buscar…"
                    className="flex-1 bg-transparent text-[10px] text-strong placeholder:text-faint outline-none" />
                </div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {proponentesFiltrados.map(([cnpj, { proponente }]) => (
                    <button key={cnpj}
                      onClick={() => setQueryProponente((p) => p === proponente ? '' : proponente)}
                      className={clsx('w-full text-left text-[10px] font-mono-custom px-1.5 py-1 rounded transition-all',
                        queryProponente === proponente ? 'bg-accent/15 text-accent' : 'text-muted hover:text-strong hover:bg-bg3')}>
                      {proponente.substring(0, 33)}{proponente.length > 33 ? '…' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Main area ───────────────────────────────────────────────── */}
            <div className="flex-1 min-w-0 space-y-3">

              {/* UF bar */}
              <div className="bg-bg2 border border-subtle2 rounded-xl p-3">
                <div className="flex gap-1 flex-wrap">
                  <button onClick={() => setUfsAtivos(new Set())}
                    className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                      ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                    Todos
                  </button>
                  {UFS.map((uf) => {
                    const hasData = all.some((l) => l.uf === uf)
                    if (!hasData) return null
                    return (
                      <button key={uf}
                        onClick={() => setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })}
                        className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                          ufsAtivos.has(uf) ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                        {uf}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Table */}
              <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
                {loading ? (
                  <div className="p-10 text-center text-faint text-[13px]">Carregando dados 2023–2025…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-10 text-center text-faint text-[13px]">Nenhum resultado com os filtros aplicados.</div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-subtle bg-bg3/40">
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Item</th>
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5 w-10">UF</th>
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Proponente</th>
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Status</th>
                        <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((l) => {
                        const isOpen = expandedId === l.id
                        const itens = itensCache[l.id] ?? []
                        return (
                          <React.Fragment key={l.id}>
                            <tr
                              className={clsx('border-b border-subtle transition-colors cursor-pointer group',
                                isOpen ? 'bg-bg3' : 'hover:bg-bg3')}
                              onClick={() => toggleRow(l)}>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase flex-shrink-0', CAT_COLOR[l.categoria])}>
                                    {CAT_LABEL[l.categoria] ?? l.categoria}
                                  </span>
                                  <span className="text-[11px] text-strong max-w-[180px] truncate">{l.descricao}</span>
                                  <span className="ml-auto text-faint opacity-0 group-hover:opacity-100 transition-opacity">
                                    {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                  </span>
                                </div>
                                <div className="text-[9px] font-mono-custom text-faint mt-0.5 pl-[54px]">{l.numeroControlePNCP}</div>
                              </td>
                              <td className="px-3 py-2.5 text-[11px] font-mono-custom text-faint">{l.uf}</td>
                              <td className="px-4 py-2.5">
                                <div className="text-[11px] text-strong max-w-[200px] truncate">{l.proponente}</div>
                                <div className="text-[9px] text-faint font-mono-custom">{l.municipio} · {l.ano} · {l.modalidade}</div>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                                  SITUACAO_CLASS[l.situacaoId as keyof typeof SITUACAO_CLASS] ?? SITUACAO_CLASS[4])}>
                                  {l.situacao}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="text-[12px] font-mono-custom font-bold text-strong">{formatBRL(l.valor)}</div>
                                {l.link && (
                                  <a href={l.link} target="_blank" rel="noopener noreferrer"
                                    className="text-[9px] text-faint hover:text-accent transition-colors inline-flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100"
                                    onClick={(e) => e.stopPropagation()}>
                                    <ExternalLink size={9} /> Edital
                                  </a>
                                )}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="border-b border-subtle bg-bg3/40">
                                <td colSpan={5} className="px-6 py-4">
                                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <Package size={11} />
                                    Itens da licitação
                                    {l.link && (
                                      <a href={l.link} target="_blank" rel="noopener noreferrer"
                                        className="ml-auto inline-flex items-center gap-1 text-faint hover:text-accent transition-colors"
                                        onClick={(e) => e.stopPropagation()}>
                                        <ExternalLink size={10} /> Ver edital
                                      </a>
                                    )}
                                  </div>
                                  {itensLoading && expandedId === l.id ? (
                                    <div className="text-[11px] text-faint py-2">Carregando itens…</div>
                                  ) : itens.length === 0 ? (
                                    <div className="text-[11px] text-faint py-2">
                                      Itens não disponíveis no PNCP para esta licitação.
                                    </div>
                                  ) : (
                                    <table className="w-full">
                                      <thead>
                                        <tr className="border-b border-subtle">
                                          <th className="text-left text-[8px] font-mono-custom text-faint uppercase tracking-wider pb-1.5 w-8">#</th>
                                          <th className="text-left text-[8px] font-mono-custom text-faint uppercase tracking-wider pb-1.5">Descrição</th>
                                          <th className="text-right text-[8px] font-mono-custom text-faint uppercase tracking-wider pb-1.5 w-16">Qtd</th>
                                          <th className="text-right text-[8px] font-mono-custom text-faint uppercase tracking-wider pb-1.5 w-24">Valor unit.</th>
                                          <th className="text-right text-[8px] font-mono-custom text-faint uppercase tracking-wider pb-1.5 w-28">Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {itens.map((item) => (
                                          <tr key={item.numeroItem} className="border-b border-subtle/50 last:border-0">
                                            <td className="py-1.5 text-[10px] font-mono-custom text-faint">{item.numeroItem}</td>
                                            <td className="py-1.5 text-[11px] text-strong pr-4">{item.descricao}</td>
                                            <td className="py-1.5 text-right text-[10px] font-mono-custom text-muted">
                                              {item.quantidade} {item.unidadeMedida}
                                            </td>
                                            <td className="py-1.5 text-right text-[10px] font-mono-custom text-muted">
                                              {formatBRL(item.valorUnitarioEstimado)}
                                            </td>
                                            <td className="py-1.5 text-right text-[11px] font-mono-custom font-bold text-strong">
                                              {formatBRL(item.quantidade * item.valorUnitarioEstimado)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                  <div className="mt-3 pt-3 border-t border-subtle">
                                    <PrecosReferencia termo={l.descricao} uf={l.uf} />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
