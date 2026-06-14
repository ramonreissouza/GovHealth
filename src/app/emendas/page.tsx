'use client'
// src/app/emendas/page.tsx — Emendas Parlamentares de Saúde
// Verbas parlamentares destinadas à função "Saúde" (Portal da Transparência).

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { Search, Landmark, User, MapPin } from 'lucide-react'
import type { EmendaView } from '@/app/api/emendas/route'
import { formatBRL } from '@/lib/format'

const ANOS = ['auto', '2026', '2025', '2024', '2023']
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

interface ApiResponse {
  emendas: EmendaView[]
  ano: number
  total: number
  totalEmpenhado: number
  totalPago: number
  pctExecucaoGeral: number
  error?: string
  instrucoes?: string
}

export default function EmendasPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [ano, setAno] = useState('auto')
  const [query, setQuery] = useState('')
  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams()
      if (ano !== 'auto') params.set('ano', ano)
      const res = await fetch(`/api/emendas?${params}`)
      const json: ApiResponse = await res.json()
      if (!res.ok) { setErro(json.instrucoes ?? json.error ?? 'Erro ao buscar emendas'); setData(null) }
      else setData(json)
    } catch (e) {
      setErro(String(e)); setData(null)
    } finally { setLoading(false) }
  }, [ano])

  useEffect(() => { load() }, [load])

  const all = data?.emendas ?? []

  const filtered = all.filter((e) => {
    if (ufsAtivos.size > 0) {
      const loc = (e.localidadeDoGasto ?? '').toUpperCase()
      if (![...ufsAtivos].some((uf) => loc.includes(uf))) return false
    }
    if (query) {
      const q = query.toLowerCase()
      return (
        (e.autor ?? '').toLowerCase().includes(q) ||
        (e.localidadeDoGasto ?? '').toLowerCase().includes(q) ||
        (e.subfuncao ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const totalEmpenhado = filtered.reduce((s, e) => s + e.empenhado, 0)
  const totalPago = filtered.reduce((s, e) => s + e.pago, 0)
  const pctGeral = totalEmpenhado > 0 ? Math.round((totalPago / totalEmpenhado) * 100) : 0

  const KPIS = [
    { label: 'Emendas de saúde', value: String(filtered.length), sub: data ? `ano ${data.ano}` : '' },
    { label: 'Total empenhado', value: formatBRL(totalEmpenhado), sub: 'verba comprometida' },
    { label: 'Total pago', value: formatBRL(totalPago), sub: 'já desembolsado' },
    { label: 'Execução', value: `${pctGeral}%`, sub: 'pago / empenhado' },
  ]

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Emendas Parlamentares de Saúde"
          subtitle={loading ? 'Carregando…' : `${filtered.length} emendas · ${formatBRL(totalEmpenhado)} empenhados`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          <div className="mb-4 max-w-[680px]">
            <p className="text-[13px] text-muted leading-relaxed">
              Verbas parlamentares destinadas à função <span className="text-strong">Saúde</span>. Emendas com alto valor
              empenhado e baixa execução sinalizam <span className="text-accent">compras iminentes</span> no município —
              fonte primária de oportunidades antes da publicação do edital.
            </p>
          </div>

          {/* ── Filtros ──────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* Ano */}
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1">
              {ANOS.map((a) => (
                <button key={a} onClick={() => setAno(a)}
                  className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                    ano === a ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                  {a === 'auto' ? 'Recente' : a}
                </button>
              ))}
            </div>

            {/* Busca */}
            <div className="flex items-center gap-2 bg-bg2 border border-subtle2 rounded-lg px-3 py-2 flex-1 min-w-[220px]">
              <Search size={13} className="text-faint flex-shrink-0" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por autor, localidade ou subfunção…"
                className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
            </div>
          </div>

          {/* UF bar */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex gap-1 flex-wrap">
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

          {/* ── KPIs ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {KPIS.map(({ label, value, sub }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className="text-[20px] font-mono-custom font-bold text-strong mt-0.5 leading-tight">{value}</div>
                <div className="text-[10px] text-faint font-mono-custom mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Conteúdo ─────────────────────────────────────────────────── */}
          {loading ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Carregando emendas de saúde… pode levar alguns segundos.
            </div>
          ) : erro ? (
            <div className="bg-bg2 border border-amber/30 rounded-xl p-8 text-center">
              <Landmark size={28} className="text-amber mx-auto mb-3" />
              <div className="text-[13px] text-strong mb-1">Não foi possível carregar as emendas</div>
              <div className="text-[12px] text-muted max-w-[480px] mx-auto">{erro}</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Nenhuma emenda de saúde encontrada com os filtros aplicados.
            </div>
          ) : (
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-subtle bg-bg3/30">
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Localidade</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Autor</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Subfunção</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Empenhado</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Pago</th>
                    <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5 w-28">Execução</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, idx) => (
                    <tr key={`${e.codigoEmenda}-${idx}`} className="border-b border-subtle last:border-0 hover:bg-bg3 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-[12px] text-strong">
                          <MapPin size={11} className="text-faint flex-shrink-0" />
                          {e.localidadeDoGasto || '—'}
                        </div>
                        <div className="text-[9px] text-faint font-mono-custom mt-0.5">{e.tipoEmenda} · nº {e.numeroEmenda}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-[12px] text-muted max-w-[220px] truncate">
                          <User size={11} className="text-faint flex-shrink-0" />
                          {e.autor || '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted max-w-[160px] truncate">{e.subfuncao || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-[12px] font-mono-custom font-bold text-strong">{formatBRL(e.empenhado)}</td>
                      <td className="px-4 py-2.5 text-right text-[11px] font-mono-custom text-muted">{formatBRL(e.pago)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden">
                            <div className={clsx('h-full rounded-full', e.pctExecucao >= 80 ? 'bg-emerald-500' : e.pctExecucao >= 40 ? 'bg-amber' : 'bg-accent')}
                              style={{ width: `${Math.min(e.pctExecucao, 100)}%` }} />
                          </div>
                          <span className="text-[10px] font-mono-custom text-faint w-9 text-right">{e.pctExecucao}%</span>
                        </div>
                      </td>
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
