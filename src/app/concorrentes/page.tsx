'use client'
// src/app/concorrentes/page.tsx — Radar de Concorrência
// Explorador de concorrentes: filtra por categoria/estado/ano, lista fornecedores
// e, ao clicar, mostra nº de contratos e as licitações que venceu — cada uma
// expansível com instituição, itens vendidos (descrição, qtd, valores) e data.
// Fonte: resultados homologados do PNCP (banco populado pelo ETL).

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Search, Trophy, Database, Building2, ChevronRight, ExternalLink, MapPin, X } from 'lucide-react'
import { formatBRL, formatDate } from '@/lib/format'
import { CATEGORIAS, CATEGORIA_LABEL } from '@/lib/categoria-mercado'
import { publishDataStatus } from '@/lib/data-status'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['todos', '2026', '2025', '2024', '2023']

interface Ranking { fornecedor: string | null; cnpj: string | null; valor: number; itens: number; convenios: number; ufs: number }
interface CatCount { categoria: string; n: number; valor: number }
interface RankResponse {
  kpis: { valorTotal: number; fornecedores: number; itens: number; convenios: number }
  ranking: Ranking[]
  categorias?: CatCount[]
  atualizadoEm?: string
  fonte?: string
  error?: string
  instrucoes?: string
}

interface ContratoItem { numero_item: number | null; nome_catmat: string | null; codigo_catmat: string | null; categoria: string | null; qtd: number | null; valor_unitario: number | null; valor: number | null }
interface Contrato {
  convenio: string
  proponente: string | null
  municipio: string | null
  uf: string | null
  modalidade_nome: string | null
  objeto_compra: string | null
  data: string | null
  pncp_url: string | null
  valorTotal: number
  itens: ContratoItem[]
}
interface ContratosResponse {
  fornecedor: string
  resumo: { valorTotal: number; convenios: number; itens: number; ufs: number; ufsAtuacao: string[] }
  contratos: Contrato[]
  error?: string
}

export default function ConcorrentesPage() {
  const [rank, setRank] = useState<RankResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [ano, setAno] = useState('2026') // default leve: evita varrer a base inteira no 1º load
  const [catAtiva, setCatAtiva] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [buscaQuery, setBuscaQuery] = useState('') // debounced → enviado ao servidor

  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [contratos, setContratos] = useState<ContratosResponse | null>(null)
  const [contratosLoading, setContratosLoading] = useState(false)
  const [convAberto, setConvAberto] = useState<string | null>(null)

  const filtrosParams = useCallback(() => {
    const params = new URLSearchParams()
    if (ufsAtivos.size > 0) params.set('uf', [...ufsAtivos].join(','))
    if (ano !== 'todos') params.set('ano', ano)
    if (catAtiva) params.set('categoria', catAtiva)
    return params
  }, [ufsAtivos, ano, catAtiva])

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const params = filtrosParams(); params.set('limit', '100')
      if (buscaQuery) params.set('q', buscaQuery)
      const res = await fetch(`/api/resultados/fornecedores?${params}`)
      const json: RankResponse = await res.json()
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setRank(null) }
      else { setRank(json); publishDataStatus(json) }
    } catch (e) { setErro({ msg: String(e) }); setRank(null) }
    finally { setLoading(false) }
  }, [filtrosParams, buscaQuery])

  useEffect(() => { load() }, [load])

  // debounce da busca por nome (server-side): acha qualquer fornecedor, não só o top 100.
  useEffect(() => { const t = setTimeout(() => setBuscaQuery(busca.trim()), 350); return () => clearTimeout(t) }, [busca])

  // Contratos do fornecedor selecionado.
  useEffect(() => {
    if (!selecionado) { setContratos(null); return }
    let vivo = true
    setContratosLoading(true); setConvAberto(null)
    const params = filtrosParams()
    params.set('fornecedor', selecionado)
    fetch(`/api/resultados/fornecedor-contratos?${params}`)
      .then(async (r) => { const j: ContratosResponse = await r.json(); if (vivo) setContratos(r.ok ? j : null) })
      .catch(() => { if (vivo) setContratos(null) })
      .finally(() => { if (vivo) setContratosLoading(false) })
    return () => { vivo = false }
  }, [selecionado, filtrosParams])

  const kpis = rank?.kpis
  const ranking = rank?.ranking ?? []
  const catMap = new Map((rank?.categorias ?? []).map((c) => [c.categoria, c.n]))
  const maxValor = ranking.length ? Math.max(...ranking.map((r) => r.valor || 0)) : 0
  const escopoLabel = ufsAtivos.size === 0 ? 'Brasil (todos os estados)' : [...ufsAtivos].sort().join(', ')

  const toggleUf = (uf: string) => setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })

  const KPI_CARDS = [
    { label: 'Valor total homologado', value: kpis ? formatBRL(kpis.valorTotal) : '—' },
    { label: 'Concorrentes', value: kpis ? String(kpis.fornecedores) : '—' },
    { label: 'Itens únicos', value: kpis ? String(kpis.itens) : '—' },
    { label: 'Licitações', value: kpis ? String(kpis.convenios) : '—' },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Radar de Concorrência"
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
                placeholder="Buscar concorrente por nome…"
                className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
            </div>
          </div>

          {erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Database size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">{erro.msg}</div>
              {erro.instrucoes && <div className="text-[12px] text-muted font-mono-custom">{erro.instrucoes}</div>}
            </div>
          ) : (
            <div className={clsx('grid gap-3', selecionado ? 'grid-cols-[minmax(320px,1fr)_1.4fr]' : 'grid-cols-1')}>
              {/* Lista de concorrentes */}
              <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden self-start">
                <div className="px-4 py-2.5 border-b border-subtle bg-bg3/30 text-[10px] font-mono-custom text-faint uppercase tracking-wider">
                  Concorrentes {catAtiva ? `· ${CATEGORIA_LABEL[catAtiva] ?? catAtiva}` : ''} — clique para ver as licitações
                </div>
                {loading ? (
                  <div className="p-10 text-center text-faint text-[13px]">Carregando concorrentes…</div>
                ) : ranking.length === 0 ? (
                  <div className="p-10 text-center text-faint text-[13px]">
                    {buscaQuery ? `Nenhum concorrente encontrado para “${buscaQuery}” com os filtros atuais.` : 'Nenhum concorrente com os filtros atuais.'}
                  </div>
                ) : (
                  <div className="divide-y divide-subtle max-h-[70vh] overflow-y-auto">
                    {ranking.map((r, i) => {
                      const ativo = selecionado === r.fornecedor
                      const pct = maxValor > 0 ? (r.valor / maxValor) * 100 : 0
                      return (
                        <button key={`${r.fornecedor}-${i}`}
                          onClick={() => setSelecionado(ativo ? null : r.fornecedor)}
                          className={clsx('w-full text-left px-4 py-2.5 transition-colors relative', ativo ? 'bg-bg3' : 'hover:bg-bg3')}>
                          <span className="absolute left-0 top-0 bottom-0 bg-accent/5" style={{ width: `${pct}%` }} />
                          <div className="relative flex items-center gap-3">
                            <ChevronRight size={13} className={clsx('text-faint flex-shrink-0 transition-transform', ativo && 'rotate-90')} />
                            <span className={clsx('w-5 text-center text-[11px] font-mono-custom font-bold flex-shrink-0',
                              i === 0 ? 'text-amber' : i < 3 ? 'text-strong' : 'text-faint')}>{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[12px] text-strong truncate">
                                {i === 0 && <Trophy size={11} className="text-amber flex-shrink-0" />}
                                {r.fornecedor ?? '—'}
                              </div>
                              <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                                {r.convenios} licitação{r.convenios !== 1 ? 'ões' : ''} · {r.itens} item{r.itens !== 1 ? 's' : ''} · {r.ufs} UF{r.ufs !== 1 ? 's' : ''}
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

              {/* Drill-down: licitações do concorrente */}
              {selecionado && (
                <div className="bg-bg2 border border-subtle rounded-xl p-4 self-start">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider">Concorrente</div>
                      <div className="text-[15px] font-semibold text-strong leading-tight">{selecionado}</div>
                      {contratos?.resumo && (
                        <div className="text-[10px] font-mono-custom text-faint mt-1">
                          <span className="text-accent">{formatBRL(contratos.resumo.valorTotal)}</span>
                          {' · '}{contratos.resumo.convenios} licitação{contratos.resumo.convenios !== 1 ? 'ões' : ''}
                          {' · '}{contratos.resumo.itens} itens
                          {contratos.resumo.ufsAtuacao.length > 0 && <> · {contratos.resumo.ufsAtuacao.join(', ')}</>}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setSelecionado(null)} className="text-faint hover:text-strong flex-shrink-0"><X size={16} /></button>
                  </div>

                  {contratosLoading ? (
                    <div className="text-[12px] text-faint py-6 text-center">Carregando licitações vencidas…</div>
                  ) : !contratos || contratos.contratos.length === 0 ? (
                    <div className="text-[12px] text-faint py-6 text-center">Nenhuma licitação encontrada com os filtros atuais.</div>
                  ) : (
                    <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                      {contratos.contratos.map((c) => {
                        const aberto = convAberto === c.convenio
                        return (
                          <div key={c.convenio} className="border border-subtle2 rounded-lg overflow-hidden">
                            <button onClick={() => setConvAberto(aberto ? null : c.convenio)}
                              className={clsx('w-full text-left px-3 py-2.5 transition-colors', aberto ? 'bg-bg3' : 'hover:bg-bg3')}>
                              <div className="flex items-center gap-2">
                                <ChevronRight size={12} className={clsx('text-faint flex-shrink-0 transition-transform', aberto && 'rotate-90')} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 text-[12px] text-strong">
                                    <Building2 size={11} className="text-faint flex-shrink-0" />
                                    <span className="truncate">{c.proponente ?? '—'}</span>
                                  </div>
                                  <div className="text-[9px] font-mono-custom text-faint mt-0.5 flex items-center gap-2 flex-wrap">
                                    {(c.municipio || c.uf) && <span className="flex items-center gap-0.5"><MapPin size={9} />{[c.municipio, c.uf].filter(Boolean).join('/')}</span>}
                                    {c.modalidade_nome && <span>{c.modalidade_nome}</span>}
                                    {c.data && <span>{formatDate(c.data)}</span>}
                                    <span>{c.itens.length} item{c.itens.length !== 1 ? 's' : ''}</span>
                                  </div>
                                </div>
                                <div className="text-[12px] font-mono-custom font-bold text-accent flex-shrink-0">{formatBRL(c.valorTotal)}</div>
                              </div>
                            </button>
                            {aberto && (
                              <div className="border-t border-subtle2 bg-bg/40 px-3 py-2.5">
                                {c.objeto_compra && (
                                  <div className="text-[10px] text-muted mb-2 leading-snug"><span className="text-faint">Objeto: </span>{c.objeto_compra}</div>
                                )}
                                <table className="w-full">
                                  <thead>
                                    <tr className="border-b border-subtle2">
                                      <th className="text-left text-[8px] font-mono-custom text-faint uppercase tracking-wider py-1.5">Item vendido</th>
                                      <th className="text-right text-[8px] font-mono-custom text-faint uppercase tracking-wider py-1.5 px-2">Qtd</th>
                                      <th className="text-right text-[8px] font-mono-custom text-faint uppercase tracking-wider py-1.5 px-2">Unit.</th>
                                      <th className="text-right text-[8px] font-mono-custom text-faint uppercase tracking-wider py-1.5">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.itens.map((it, idx) => (
                                      <tr key={idx} className="border-b border-subtle2/50 last:border-0">
                                        <td className="py-1.5 pr-2 text-[10px] text-strong">
                                          {it.codigo_catmat ? <span className="font-mono-custom text-faint">{it.codigo_catmat} · </span> : null}
                                          {it.nome_catmat ?? '—'}
                                          {it.categoria && <span className="ml-1 text-[8px] text-faint">[{CATEGORIA_LABEL[it.categoria] ?? it.categoria}]</span>}
                                        </td>
                                        <td className="py-1.5 px-2 text-right text-[10px] font-mono-custom text-muted">{it.qtd ?? '—'}</td>
                                        <td className="py-1.5 px-2 text-right text-[10px] font-mono-custom text-muted">{it.valor_unitario != null ? formatBRL(it.valor_unitario) : '—'}</td>
                                        <td className="py-1.5 text-right text-[10px] font-mono-custom font-bold text-strong">{formatBRL(it.valor)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="flex items-center justify-between mt-2">
                                  <span className="text-[9px] font-mono-custom text-faint">Nº controle PNCP: {c.convenio}</span>
                                  {c.pncp_url && (
                                    <a href={c.pncp_url} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline">
                                      <ExternalLink size={10} /> Ver no PNCP
                                    </a>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
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
