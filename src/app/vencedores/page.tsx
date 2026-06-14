'use client'
// src/app/vencedores/page.tsx — TELA 1: Análise de Vencedores (resultados homologados do PNCP)
// Lê do banco via /api/resultados/vencedores (populado pelo ETL).

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Search, Trophy, Database } from 'lucide-react'
import { formatBRL } from '@/lib/format'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

interface Vencedor {
  proponente: string | null
  convenio: string
  vencedor: string | null
  codigo_catmat: string | null
  nome_catmat: string | null
  qtd: number | null
  valor: number | null
  uf: string | null
  ano: number | null
}
interface ApiResponse {
  kpis: { valorTotal: number; ticketMedio: number; itensUnicos: number; convenios: number; consumidores: number }
  vencedores: Vencedor[]
  total: number
  error?: string
  instrucoes?: string
}

export default function VencedoresPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<{ msg: string; instrucoes?: string } | null>(null)

  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [empresa, setEmpresa] = useState('')
  const [empresaQuery, setEmpresaQuery] = useState('')

  // debounce do campo empresa
  useEffect(() => { const t = setTimeout(() => setEmpresaQuery(empresa), 400); return () => clearTimeout(t) }, [empresa])

  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const params = new URLSearchParams({ limit: '500' })
      if (ufsAtivos.size > 0) params.set('uf', [...ufsAtivos].join(','))
      if (empresaQuery) params.set('empresa', empresaQuery)
      const res = await fetch(`/api/resultados/vencedores?${params}`)
      const json: ApiResponse = await res.json()
      if (!res.ok) { setErro({ msg: json.error ?? 'Erro', instrucoes: json.instrucoes }); setData(null) }
      else setData(json)
    } catch (e) { setErro({ msg: String(e) }); setData(null) }
    finally { setLoading(false) }
  }, [ufsAtivos, empresaQuery])

  useEffect(() => { load() }, [load])

  const kpis = data?.kpis
  const vencedores = data?.vencedores ?? []

  const KPI_CARDS = [
    { label: 'Valor total homologado', value: kpis ? formatBRL(kpis.valorTotal) : '—' },
    { label: 'Ticket médio', value: kpis ? formatBRL(kpis.ticketMedio) : '—' },
    { label: 'Itens únicos', value: kpis ? String(kpis.itensUnicos) : '—' },
    { label: 'Convênios', value: kpis ? String(kpis.convenios) : '—' },
    { label: 'Consumidores', value: kpis ? String(kpis.consumidores) : '—' },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Análise de Vencedores"
          subtitle={loading ? 'Carregando…' : `${data?.total ?? 0} resultados homologados`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* KPIs */}
          <div className="grid grid-cols-5 gap-3 mb-4">
            {KPI_CARDS.map(({ label, value }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className="text-[18px] font-mono-custom font-bold text-strong mt-0.5 leading-tight">{value}</div>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex gap-1 flex-wrap items-center">
              <button onClick={() => setUfsAtivos(new Set())}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todas UFs
              </button>
              {UFS.map((uf) => (
                <button key={uf} onClick={() => setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })}
                  className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                    ufsAtivos.has(uf) ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                  {uf}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 bg-bg2 border border-subtle2 rounded-lg px-3 py-2 mb-4 max-w-md">
            <Search size={13} className="text-faint flex-shrink-0" />
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)}
              placeholder="Buscar empresa vencedora…"
              className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
          </div>

          {/* Conteúdo */}
          {loading ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">Carregando vencedores…</div>
          ) : erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Database size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">{erro.msg}</div>
              {erro.instrucoes && <div className="text-[12px] text-muted max-w-[520px] mx-auto font-mono-custom">{erro.instrucoes}</div>}
            </div>
          ) : vencedores.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Nenhum resultado homologado ainda. Rode o ETL (<span className="font-mono-custom">npm run etl</span>) para popular o banco.
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-subtle bg-bg3/30">
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Proponente</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Convênio</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Vencedor</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Item</th>
                    <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-2 py-2.5 w-10">UF</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Qtd</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor vencedor</th>
                  </tr>
                </thead>
                <tbody>
                  {vencedores.map((v, i) => (
                    <tr key={`${v.convenio}-${i}`} className="border-b border-subtle last:border-0 hover:bg-bg3 transition-colors">
                      <td className="px-4 py-2.5 text-[11px] text-strong max-w-[200px] truncate">{v.proponente ?? '—'}</td>
                      <td className="px-3 py-2.5 text-[10px] font-mono-custom text-faint max-w-[140px] truncate">{v.convenio}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-[12px] text-strong max-w-[200px] truncate">
                          <Trophy size={11} className="text-amber flex-shrink-0" />
                          {v.vencedor ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-muted max-w-[200px] truncate">
                        {v.codigo_catmat ? <span className="font-mono-custom text-faint">{v.codigo_catmat} · </span> : null}{v.nome_catmat ?? '—'}
                      </td>
                      <td className="px-2 py-2.5 text-center text-[11px] font-mono-custom text-faint">{v.uf ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right text-[11px] font-mono-custom text-muted">{v.qtd ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right text-[12px] font-mono-custom font-bold text-strong">{v.valor != null ? formatBRL(v.valor) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
