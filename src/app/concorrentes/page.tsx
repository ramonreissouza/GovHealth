'use client'
// src/app/concorrentes/page.tsx — Principais Concorrentes (referencia3)

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts'
import { Search } from 'lucide-react'
import type { LicitacaoEnriquecida } from '@/app/api/licitacoes/route'
import type { VencedorAgregado } from '@/app/api/vencedores/route'
import { CATEGORIA_LABEL as CAT_LABEL } from '@/lib/categorias'
import { formatBRL } from '@/lib/format'

// ── Constants ────────────────────────────────────────────────────────────────

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['2023','2024','2025']
const PIE_COLORS = ['#60a5fa','#f87171','#f59e0b','#c084fc','#4ade80','#94a3b8']

const CAT_COLOR: Record<string, string> = {
  imagem: 'bg-blue-500/20 text-blue-400', uti: 'bg-red-500/20 text-red-400',
  laboratorio: 'bg-amber-500/20 text-amber-400', cirurgia: 'bg-purple-500/20 text-purple-400',
  oncologia: 'bg-green-500/20 text-green-400', medicamento: 'bg-cyan-500/20 text-cyan-400', outros: 'bg-bg4 text-faint',
}


// ── Component ─────────────────────────────────────────────────────────────────

interface ApiResponse {
  licitacoes: LicitacaoEnriquecida[]
  kpis: { total: number; valorTotal: number; ticketMedio: number }
  porCategoria: Record<string, { count: number; valor: number }>
  topProponentes: { cnpj: string; proponente: string; uf: string; municipio: string; valor: number; count: number }[]
}

export default function ConcorrentesPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [vencedores, setVencedores] = useState<VencedorAgregado[]>([])
  const [vencLoading, setVencLoading] = useState(true)
  const [vencFallback, setVencFallback] = useState(false)
  const [vencFallbackMsg, setVencFallbackMsg] = useState('')

  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [categoriasAtivas, setCategoriasAtivas] = useState<Set<string>>(new Set())
  const [anosAtivos, setAnosAtivos] = useState<Set<string>>(new Set(['2024', '2025']))
  const [situacao, setSituacao] = useState('todos')
  const [queryProponente, setQueryProponente] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setVencLoading(true)
    try {
      const [licitRes, vencRes] = await Promise.allSettled([
        fetch('/api/licitacoes?limit=500'),
        fetch('/api/vencedores'),
      ])
      if (licitRes.status === 'fulfilled') setData(await licitRes.value.json())
      if (vencRes.status === 'fulfilled') {
        const json = await vencRes.value.json()
        setVencedores(json.vencedores ?? [])
        setVencFallback(json.fallback ?? false)
        setVencFallbackMsg(json.fallbackMsg ?? '')
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false); setVencLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const all = data?.licitacoes ?? []

  // Apply filters
  const filtered = all.filter((l) => {
    if (anosAtivos.size > 0 && !anosAtivos.has(l.ano)) return false
    if (categoriasAtivas.size > 0 && !categoriasAtivas.has(l.categoria)) return false
    if (ufsAtivos.size > 0 && !ufsAtivos.has(l.uf)) return false
    if (situacao === 'aberto' && l.situacaoId !== 1) return false
    if (situacao === 'encerrado' && l.situacaoId === 1) return false
    return true
  })

  // Top 3 vencedores (fornecedores reais) — filtrados por categoria se selecionada
  const top3 = (categoriasAtivas.size > 0
    ? vencedores.filter((v) => v.categorias.some((c) => categoriasAtivas.has(c)))
    : vencedores
  ).slice(0, 3)

  // Pie chart — by categoria from filtered
  const pieMap: Record<string, { count: number; valor: number }> = {}
  for (const l of filtered) {
    if (!pieMap[l.categoria]) pieMap[l.categoria] = { count: 0, valor: 0 }
    pieMap[l.categoria].count++
    pieMap[l.categoria].valor += l.valor
  }
  const pieData = Object.entries(pieMap)
    .sort((a, b) => b[1].valor - a[1].valor)
    .map(([key, { count, valor }]) => ({ name: CAT_LABEL[key] ?? key, value: valor, count, key }))

  // Entities (unique orgs with search filter)
  const entidades = [...new Map(
    filtered
      .filter((l) => !queryProponente || l.proponente.toLowerCase().includes(queryProponente.toLowerCase()))
      .map((l) => [l.cnpj, { proponente: l.proponente, uf: l.uf }])
  ).entries()].slice(0, 30)

  const pieTotal = pieData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Radar de Concorrência" subtitle={loading ? 'Carregando…' : `${filtered.length} licitações · ${formatBRL(filtered.reduce((s, l) => s + l.valor, 0))}`} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg space-y-4">

          {/* ── TOP 3 TABLE ──────────────────────────────────────────────── */}
          <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-subtle bg-bg3/30 flex items-center justify-between">
              <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">
                {vencFallback
                  ? 'Ranking Top 3 — Maiores Compradores de Equipamentos (proxy)'
                  : 'Ranking Top 3 — Principais Fornecedores Vencedores de Equipamentos de Saúde'}
              </span>
              {vencFallback && (
                <span className="text-[9px] font-mono-custom text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                  Dados de fornecedores indisponíveis — exibindo compradores
                </span>
              )}
            </div>
            {vencFallback && vencFallbackMsg && (
              <div className="px-4 py-2 text-[10px] text-faint font-mono-custom border-b border-subtle bg-bg3/10">
                {vencFallbackMsg}
              </div>
            )}
            <table className="w-full">
              <thead>
                <tr className="border-b border-subtle">
                  <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5 w-8">#</th>
                  <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Fornecedor</th>
                  <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor homologado</th>
                  <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Contratos</th>
                  <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Categorias</th>
                  <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">UFs atuação</th>
                </tr>
              </thead>
              <tbody>
                {vencLoading ? (
                  <tr><td colSpan={6} className="text-center py-6 text-faint text-[12px]">Buscando vencedores no PNCP… (pode levar ~15s)</td></tr>
                ) : top3.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-6 text-faint text-[12px]">Sem dados de vencedores disponíveis. O PNCP pode não ter homologações neste período.</td></tr>
                ) : top3.map((v, i) => (
                  <tr key={v.id} className="border-b border-subtle last:border-0 hover:bg-bg3 transition-colors">
                    <td className="px-4 py-3">
                      <span className={clsx('w-6 h-6 rounded-full inline-flex items-center justify-center font-mono-custom text-[11px] font-bold',
                        i === 0 ? 'bg-amber-400/20 text-amber-400' : i === 1 ? 'bg-zinc-500/20 text-zinc-400' : 'bg-bg4 text-faint')}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[12px] text-strong max-w-[280px]">{v.nome}</div>
                      {v.cnpj && <div className="text-[9px] font-mono-custom text-faint mt-0.5">{v.cnpj}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] font-mono-custom font-bold text-accent">{formatBRL(v.valor)}</td>
                    <td className="px-4 py-3 text-center text-[12px] font-mono-custom text-muted">{v.contratos}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {v.categorias.map((c) => (
                          <span key={c} className={clsx('text-[8px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase', CAT_COLOR[c])}>
                            {CAT_LABEL[c] ?? c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {v.ufs.map((uf) => (
                          <span key={uf} className="text-[9px] font-mono-custom text-faint bg-bg3 px-1.5 py-0.5 rounded">{uf}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── BAR CHART vencedores ──────────────────────────────────────── */}
          {!vencLoading && vencedores.length > 0 && (
            <div className="bg-bg2 border border-subtle rounded-xl p-4">
              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">
                Top {Math.min(vencedores.length, 8)} fornecedores — valor homologado
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart
                  data={vencedores.slice(0, 8).map((v) => ({
                    nome: v.nome.length > 22 ? v.nome.substring(0, 22) + '…' : v.nome,
                    valor: v.valor / 1_000_000,
                  }))}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 9, fill: '#666' }}
                    tickLine={false} axisLine={false}
                    tickFormatter={(v) => `R$${v.toFixed(0)}M`}
                  />
                  <YAxis
                    dataKey="nome" type="category"
                    tick={{ fontSize: 9, fill: '#aaa' }}
                    tickLine={false} axisLine={false}
                    width={140}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}M`, 'Valor']}
                  />
                  <Bar dataKey="valor" fill="var(--accent)" radius={[0, 4, 4, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── UF BAR ────────────────────────────────────────────────────── */}
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

          {/* ── 3 COLUMNS ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-12 gap-4">

            {/* Left: item filter + situação + ano */}
            <div className="col-span-3 space-y-3">
              <div className="bg-bg2 border border-subtle rounded-xl p-3">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Filtro por Item</div>
                <div className="space-y-1">
                  {Object.entries(CAT_LABEL).map(([key, label]) => {
                    const count = all.filter((l) => l.categoria === key).length
                    const filtCount = filtered.filter((l) => l.categoria === key).length
                    return (
                      <button key={key}
                        onClick={() => setCategoriasAtivas((p) => { const s = new Set(p); s.has(key) ? s.delete(key) : s.add(key); return s })}
                        className={clsx('w-full flex items-center gap-2 px-2 py-2 rounded-md transition-all text-left',
                          categoriasAtivas.has(key) ? 'bg-accent/15 border border-accent/30' : 'hover:bg-bg3')}>
                        <div className={clsx('w-2 h-2 rounded-full flex-shrink-0 transition-colors',
                          categoriasAtivas.has(key) ? 'bg-accent' : 'bg-bg4')} />
                        <span className="text-[11px] text-strong flex-1">{label}</span>
                        <span className="text-[9px] font-mono-custom text-faint">{filtCount}/{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

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
            </div>

            {/* Center: pie chart */}
            <div className="col-span-5">
              <div className="bg-bg2 border border-subtle rounded-xl p-4 h-full">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider text-center mb-3">
                  Porcentagem de Itens Adquiridos
                </div>
                {!loading && pieData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} innerRadius={40} dataKey="value" paddingAngle={2}>
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => [formatBRL(Number(value)), 'Valor']}
                          contentStyle={{ background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 8, fontSize: 11 }}
                          labelStyle={{ color: '#aaa' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Legend */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
                      {pieData.map(({ name, value, key }, i) => (
                        <div key={key} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="text-[10px] text-muted flex-1 truncate">{name}</span>
                          <span className="text-[10px] font-mono-custom text-faint">
                            {pieTotal > 0 ? `${((value / pieTotal) * 100).toFixed(0)}%` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-faint text-[12px]">
                    {loading ? 'Carregando…' : 'Sem dados com os filtros atuais.'}
                  </div>
                )}
              </div>
            </div>

            {/* Right: entities */}
            <div className="col-span-4">
              <div className="bg-bg2 border border-subtle rounded-xl p-3 h-full flex flex-col">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-2">Entidades Beneficiadas</div>
                <div className="flex items-center gap-1.5 bg-bg3 border border-subtle2 rounded-lg px-2 py-1.5 mb-2">
                  <Search size={11} className="text-faint flex-shrink-0" />
                  <input value={queryProponente} onChange={(e) => setQueryProponente(e.target.value)}
                    placeholder="Buscar proponente…"
                    className="flex-1 bg-transparent text-[10px] text-strong placeholder:text-faint outline-none" />
                </div>
                <div className="flex-1 space-y-0.5 overflow-y-auto max-h-[340px]">
                  {loading ? (
                    <div className="text-center text-faint text-[11px] py-4">Carregando…</div>
                  ) : entidades.length === 0 ? (
                    <div className="text-center text-faint text-[11px] py-4">Nenhuma entidade encontrada.</div>
                  ) : entidades.map(([cnpj, { proponente, uf }]) => (
                    <div key={cnpj} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg3 transition-colors">
                      <span className="text-[9px] font-mono-custom text-faint flex-shrink-0 mt-0.5 w-5">{uf}</span>
                      <span className="text-[10px] font-mono-custom text-muted leading-tight">
                        {proponente.substring(0, 45)}{proponente.length > 45 ? '…' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </main>
      </div>
    </div>
  )
}
