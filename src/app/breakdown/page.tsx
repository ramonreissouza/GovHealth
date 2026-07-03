'use client'
// src/app/breakdown/page.tsx — TELA 2: Breakdown Item × Empresa × Estado
// Colunas conectadas: clique no item → vencedores daquele item → estados daquele item+empresa.

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Package, Trophy, MapPin, Building2, X, Database, FileText } from 'lucide-react'
import { formatBRL } from '@/lib/format'

const ANOS = ['todos', '2026', '2025', '2024', '2023']

interface Rank { chave: string | null; valor: number; qtd: number }
interface Detalhe {
  orgao: string | null
  uf: string | null
  fornecedor: string | null
  descricao: string | null
  qtd: number | null
  valor_unitario: number | null
  valor_total: number | null
  data: string | null
}
interface ApiResponse {
  valorTotal: number
  porItem: Rank[]
  porVencedor: Rank[]
  porEstado: Rank[]
  proponentes: Rank[]
  detalhes?: Detalhe[]
  error?: string
  instrucoes?: string
}

function RankColumn({
  titulo, icon, rows, selected, onSelect, color, loading,
}: {
  titulo: string
  icon: React.ReactNode
  rows: Rank[]
  selected?: string | null
  onSelect?: (v: string) => void
  color: string
  loading: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.valor ?? 0))
  return (
    <div className="bg-bg2 border border-subtle rounded-xl p-3 flex flex-col min-h-0">
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5">{icon} {titulo}</div>
      <div className="space-y-1 overflow-y-auto flex-1 max-h-[520px]">
        {loading ? <div className="text-[11px] text-faint py-2">Carregando…</div>
          : rows.length === 0 ? <div className="text-[11px] text-faint py-2">Sem dados</div>
          : rows.map((r, i) => {
            const nome = r.chave ?? '—'
            const isSel = selected != null && selected === r.chave
            const pct = Math.round(((r.valor ?? 0) / max) * 100)
            return (
              <button key={`${nome}-${i}`} onClick={() => onSelect?.(nome)} disabled={!onSelect}
                className={clsx('w-full text-left rounded-md px-2 py-1.5 transition-all relative overflow-hidden group',
                  isSel ? 'ring-1 ring-accent bg-accent/10' : onSelect ? 'hover:bg-bg3' : '')}>
                <div className="absolute inset-y-0 left-0 rounded-md opacity-20" style={{ width: `${pct}%`, background: color }} />
                <div className="relative flex items-center justify-between gap-2">
                  <span className="text-[11px] text-strong truncate">{nome}</span>
                  <span className="text-[11px] font-mono-custom font-bold text-strong flex-shrink-0">{formatBRL(r.valor ?? 0)}</span>
                </div>
                <div className="relative text-[9px] font-mono-custom text-faint">{r.qtd} {r.qtd === 1 ? 'registro' : 'registros'}</div>
              </button>
            )
          })}
      </div>
    </div>
  )
}

export default function BreakdownPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [ano, setAno] = useState('todos')
  const [item, setItem] = useState<string | null>(null)
  const [empresa, setEmpresa] = useState<string | null>(null)
  const [uf, setUf] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const params = new URLSearchParams()
      if (ano !== 'todos') params.set('ano', ano)
      if (item) params.set('item', item)
      if (empresa) params.set('empresa', empresa)
      if (uf) params.set('uf', uf)
      const res = await fetch(`/api/resultados/breakdown?${params}`)
      const json: ApiResponse = await res.json()
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setData(null) }
      else setData(json)
    } catch (e) { setErro({ msg: String(e) }); setData(null) }
    finally { setLoading(false) }
  }, [ano, item, empresa, uf])

  useEffect(() => { load() }, [load])

  const selItem = (v: string) => { setItem((p) => p === v ? null : v); setEmpresa(null); setUf(null) }
  const selEmpresa = (v: string) => setEmpresa((p) => p === v ? null : v)
  const selUf = (v: string) => setUf((p) => p === v ? null : v)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Breakdown — Item × Empresa × Estado" subtitle={loading ? 'Carregando…' : 'Resultados homologados (PNCP)'} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* KPI + filtros */}
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <div>
              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">Valor Total Homologado</div>
              <div className="text-[30px] font-mono-custom font-bold text-accent leading-none mt-1">{formatBRL(data?.valorTotal ?? 0)}</div>
            </div>
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1">
              {ANOS.map((a) => (
                <button key={a} onClick={() => setAno(a)}
                  className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                    ano === a ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                  {a === 'todos' ? 'Todos anos' : a}
                </button>
              ))}
            </div>
          </div>

          {/* Breadcrumb de seleção */}
          {(item || empresa) && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {item && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom px-2.5 py-1 bg-accent/10 border border-accent/30 text-accent rounded-full">
                  Item: {item} <button onClick={() => { setItem(null); setEmpresa(null) }}><X size={11} /></button>
                </span>
              )}
              {empresa && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom px-2.5 py-1 bg-accent/10 border border-accent/30 text-accent rounded-full">
                  Empresa: {empresa} <button onClick={() => setEmpresa(null)}><X size={11} /></button>
                </span>
              )}
              {uf && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom px-2.5 py-1 bg-accent/10 border border-accent/30 text-accent rounded-full">
                  UF: {uf} <button onClick={() => setUf(null)}><X size={11} /></button>
                </span>
              )}
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
              <div className="grid grid-cols-3 gap-3 mb-3">
                <RankColumn titulo="Item / Equipamento" icon={<Package size={11} />} rows={data?.porItem ?? []}
                  selected={item} onSelect={selItem} color="#60a5fa" loading={loading} />
                <RankColumn titulo={item ? `Vencedores · ${item.slice(0, 22)}` : 'Vencedores (geral)'} icon={<Trophy size={11} />} rows={data?.porVencedor ?? []}
                  selected={empresa} onSelect={selEmpresa} color="#00ff9d" loading={loading} />
                <RankColumn titulo="Distribuição por Estado" icon={<MapPin size={11} />} rows={data?.porEstado ?? []}
                  selected={uf} onSelect={item ? selUf : undefined} color="#f59e0b" loading={loading} />
              </div>

              {/* Proponentes */}
              <RankColumn titulo="Nome do Proponente (órgãos beneficiados)" icon={<Building2 size={11} />} rows={data?.proponentes ?? []}
                color="#c084fc" loading={loading} />

              {/* Detalhe de compra — marca/modelo/especificação + preço unitário */}
              {item && (
                <div className="mt-3 bg-bg2 border border-subtle rounded-xl p-3">
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <FileText size={11} /> Detalhe das compras — marca / modelo / especificação e preço
                    {(empresa || uf) && <span className="text-accent">· {[empresa, uf].filter(Boolean).join(' · ')}</span>}
                  </div>
                  {loading ? (
                    <div className="text-[11px] text-faint py-3">Carregando…</div>
                  ) : (data?.detalhes ?? []).length === 0 ? (
                    <div className="text-[11px] text-faint py-3">Sem detalhes para esta seleção.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-faint text-[9px] font-mono-custom uppercase tracking-wider border-b border-subtle">
                            <th className="text-left font-medium px-2 py-2">Descrição (marca / modelo / especificação)</th>
                            <th className="text-left font-medium px-2 py-2">Fornecedor</th>
                            <th className="text-left font-medium px-2 py-2">Órgão</th>
                            <th className="text-center font-medium px-2 py-2">UF</th>
                            <th className="text-right font-medium px-2 py-2">Qtd</th>
                            <th className="text-right font-medium px-2 py-2">Preço unit.</th>
                            <th className="text-right font-medium px-2 py-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(data?.detalhes ?? []).map((d, i) => (
                            <tr key={i} className="border-b border-subtle last:border-0 hover:bg-bg3 align-top">
                              <td className="px-2 py-2 text-strong max-w-[360px]"><span className="line-clamp-3">{d.descricao || '—'}</span></td>
                              <td className="px-2 py-2 text-muted max-w-[160px]"><span className="truncate block">{d.fornecedor || '—'}</span></td>
                              <td className="px-2 py-2 text-faint max-w-[160px]"><span className="truncate block">{d.orgao || '—'}</span></td>
                              <td className="px-2 py-2 text-center font-mono-custom text-faint">{d.uf || '—'}</td>
                              <td className="px-2 py-2 text-right font-mono-custom text-muted">{d.qtd != null ? Number(d.qtd).toLocaleString('pt-BR') : '—'}</td>
                              <td className="px-2 py-2 text-right font-mono-custom text-strong">{d.valor_unitario != null ? formatBRL(d.valor_unitario) : '—'}</td>
                              <td className="px-2 py-2 text-right font-mono-custom font-bold text-accent">{formatBRL(d.valor_total ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[9px] text-faint mt-2">Até 80 compras, ordenadas por valor. A descrição vem do item do processo (PNCP) — marca/modelo/especificação aparecem quando o órgão os informou.</p>
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
