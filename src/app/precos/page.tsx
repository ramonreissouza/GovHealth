'use client'
// src/app/precos/page.tsx — Painel de Preços (Compras.gov)

import React, { useState, useCallback, useEffect } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Search, TrendingDown, TrendingUp, BarChart2, Users, Building2,
  Tag, ExternalLink, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { ExportButton } from '@/components/ui/ExportButton'
import { formatBRL, formatDate } from '@/lib/format'
import type { PrecoPainelItem, EstatisticaPrecos, CatmatMaterial } from '@/lib/types'
import { getProdutos, type ProdutoPortfolio } from '@/lib/portfolio'
import { Boxes } from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────────────────

const EQUIPMENT_SHORTCUTS = [
  { label: 'Tomógrafo',        term: 'tomógrafo',        grupo: 'Equipamentos' },
  { label: 'Ressonância',      term: 'ressonância magnética', grupo: 'Equipamentos' },
  { label: 'Ultrassom',        term: 'ultrassom',        grupo: 'Equipamentos' },
  { label: 'Raio-X',           term: 'raio-x digital',   grupo: 'Equipamentos' },
  { label: 'Mamógrafo',        term: 'mamógrafo',        grupo: 'Equipamentos' },
  { label: 'Ventilador',       term: 'ventilador pulmonar', grupo: 'Equipamentos' },
  { label: 'Monitor',          term: 'monitor multiparamétrico', grupo: 'Equipamentos' },
  { label: 'Desfibrilador',    term: 'desfibrilador',    grupo: 'Equipamentos' },
  { label: 'Endoscópio',       term: 'endoscópio',       grupo: 'Equipamentos' },
  { label: 'Autoclave',        term: 'autoclave',        grupo: 'Equipamentos' },
  { label: 'Bomba infusão',    term: 'bomba de infusão', grupo: 'Equipamentos' },
  { label: 'Mesa cirúrgica',   term: 'mesa cirúrgica',   grupo: 'Equipamentos' },
  // Medicamentos / insumos farmacêuticos
  { label: 'Dipirona',         term: 'dipirona',         grupo: 'Medicamentos' },
  { label: 'Paracetamol',      term: 'paracetamol',      grupo: 'Medicamentos' },
  { label: 'Amoxicilina',      term: 'amoxicilina',      grupo: 'Medicamentos' },
  { label: 'Omeprazol',        term: 'omeprazol',        grupo: 'Medicamentos' },
  { label: 'Insulina',         term: 'insulina',         grupo: 'Medicamentos' },
  { label: 'Soro fisiológico', term: 'cloreto de sódio', grupo: 'Medicamentos' },
]

const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]

const ESFERA_LABELS: Record<string, string> = {
  todos:     'Todas',
  Federal:   'Federal',
  Estadual:  'Estadual',
  Municipal: 'Municipal',
}

// ── Helpers ───────────────────────────────────────────────────────────────────


function formatCNPJ(s: string) {
  if (!s || s.length !== 14) return s
  return `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}`
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon: Icon, color = 'text-strong' }: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  color?: string
}) {
  return (
    <div className="bg-bg2 border border-subtle rounded-xl px-4 py-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-bg4 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={15} className="text-faint" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
        <div className={clsx('text-[20px] font-mono-custom font-bold leading-tight mt-0.5', color)}>{value}</div>
        {sub && <div className="text-[10px] text-faint font-mono-custom mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

// ── Catmat panel ─────────────────────────────────────────────────────────────

function CatmatPanel({ term }: { term: string }) {
  const [materiais, setMateriais] = useState<CatmatMaterial[]>([])
  const [loading, setLoading]     = useState(false)
  const [open, setOpen]           = useState(false)

  const load = useCallback(async () => {
    if (!term || materiais.length > 0) { setOpen((p) => !p); return }
    setOpen(true)
    setLoading(true)
    try {
      const res = await fetch(`/api/comprasgov/catmat?descricao=${encodeURIComponent(term)}&tamanhoPagina=20`)
      const data = await res.json()
      setMateriais(data.materiais ?? [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [term, materiais.length])

  return (
    <div className="mt-2">
      <button
        onClick={load}
        className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-faint hover:text-strong transition-colors"
      >
        <Tag size={11} />
        Códigos CATMAT
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {open && (
        <div className="mt-2 bg-bg4/50 rounded-lg p-3">
          {loading ? (
            <div className="text-[11px] text-faint">Buscando códigos…</div>
          ) : materiais.length === 0 ? (
            <div className="text-[11px] text-faint">Nenhum material CATMAT encontrado.</div>
          ) : (
            <div className="space-y-1.5">
              {materiais.slice(0, 8).map((m) => (
                <div key={m.codigo} className="flex items-start gap-2">
                  <span className="font-mono-custom text-[10px] text-accent flex-shrink-0 w-20">{m.codigo}</span>
                  <span className="text-[11px] text-muted leading-snug">{m.descricao}</span>
                  <span className="text-[9px] font-mono-custom text-faint ml-auto flex-shrink-0">{m.unidadeFornecimento}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PrecosPage() {
  const [query, setQuery]         = useState('')
  const [uf, setUf]               = useState('')
  const [esfera, setEsfera]       = useState('todos')
  const [loading, setLoading]     = useState(false)
  const [precos, setPrecos]       = useState<PrecoPainelItem[]>([])
  const [stats, setStats]         = useState<EstatisticaPrecos | null>(null)
  const [searched, setSearched]   = useState(false)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const [sortBy, setSortBy]       = useState<'data' | 'valor'>('data')
  const [sortDir, setSortDir]     = useState<'desc' | 'asc'>('desc')
  const [produtos, setProdutos]   = useState<ProdutoPortfolio[]>([])

  // Produtos do portfólio (localStorage) — atalhos personalizados de busca de preço.
  useEffect(() => { setProdutos(getProdutos().filter((p) => p.ativo)) }, [])

  const toggle = (id: string) =>
    setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })

  const buscar = useCallback(async (term: string, codigoItem?: string) => {
    const q = term.trim()
    if (!q) return
    setQuery(q)
    setLoading(true)
    setSearched(true)
    setPrecos([])
    setStats(null)
    try {
      const params = new URLSearchParams({ descricao: q, tamanhoPagina: '200' })
      if (codigoItem) params.set('codigoItem', codigoItem)
      if (uf) params.set('uf', uf)
      if (esfera !== 'todos') params.set('esfera', esfera)
      const res = await fetch(`/api/comprasgov/precos?${params}`)
      const data = await res.json()
      setPrecos(data.precos ?? [])
      setStats(data.estatisticas ?? null)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [uf, esfera])

  // Sort + filter
  const sorted = [...precos].sort((a, b) => {
    if (sortBy === 'valor') {
      return sortDir === 'desc'
        ? b.valorUnitario - a.valorUnitario
        : a.valorUnitario - b.valorUnitario
    }
    const ta = new Date(a.dataResultado).getTime()
    const tb = new Date(b.dataResultado).getTime()
    return sortDir === 'desc' ? tb - ta : ta - tb
  })

  const toggleSort = (col: 'data' | 'valor') => {
    if (sortBy === col) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: 'data' | 'valor' }) =>
    sortBy === col
      ? sortDir === 'desc' ? <ChevronDown size={11} className="inline ml-0.5" /> : <ChevronUp size={11} className="inline ml-0.5" />
      : null

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Painel de Preços"
          subtitle={
            searched
              ? loading
                ? 'Buscando no Compras.gov…'
                : `${precos.length} registros encontrados`
              : 'Preços de referência · Compras.gov.br'
          }
        />

        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* ── Search bar ──────────────────────────────────────────────────── */}
          <div className="flex gap-2 mb-4">
            <div className="flex-1 flex items-center gap-2 bg-bg2 border border-subtle2 rounded-xl px-4 py-2.5">
              <Search size={15} className="text-faint flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscar(query)}
                placeholder="Buscar equipamento ou medicamento (ex: tomógrafo, dipirona…)"
                className="flex-1 bg-transparent text-[13px] text-strong placeholder:text-faint outline-none"
              />
              {query && (
                <button onClick={() => { setQuery(''); setPrecos([]); setStats(null); setSearched(false) }}
                  className="text-faint hover:text-strong transition-colors text-[11px]">
                  ✕
                </button>
              )}
            </div>

            {/* UF filter */}
            <select
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2 text-[12px] font-mono-custom text-strong outline-none cursor-pointer"
            >
              <option value="">Todos os estados</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>

            {/* Esfera de governo */}
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-xl p-1">
              {(['todos', 'Federal', 'Estadual', 'Municipal'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setEsfera(o)}
                  className={clsx(
                    'text-[11px] font-mono-custom px-3 py-1.5 rounded-lg transition-all',
                    esfera === o ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong'
                  )}
                >
                  {ESFERA_LABELS[o]}
                </button>
              ))}
            </div>

            {/* Search button */}
            <button
              onClick={() => buscar(query)}
              disabled={!query.trim() || loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-black font-mono-custom font-bold text-[12px] rounded-xl hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading
                ? <RefreshCw size={13} className="animate-spin" />
                : <Search size={13} />
              }
              Buscar
            </button>
          </div>

          {/* ── Atalhos do portfólio do fornecedor ───────────────────────────── */}
          {produtos.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className="flex items-center gap-1 text-[9px] font-mono-custom text-accent uppercase tracking-wider w-24 flex-shrink-0">
                <Boxes size={11} /> Meu Portfólio
              </span>
              {produtos.map((p) => {
                const termo = p.palavrasChave[0] ?? p.nome
                const cod = p.catmats[0]?.codigo
                return (
                  <button
                    key={p.id}
                    onClick={() => buscar(termo, cod)}
                    title={cod ? `Busca por CATMAT ${cod}` : `Busca por "${termo}"`}
                    className={clsx(
                      'text-[10px] font-mono-custom px-2.5 py-1 rounded-full border transition-all',
                      query === termo
                        ? 'bg-accent text-black border-accent font-bold'
                        : 'bg-accent/5 border-accent/30 text-accent hover:bg-accent/15'
                    )}
                  >
                    {p.nome}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Atalhos (Equipamentos / Medicamentos) ────────────────────────── */}
          {['Equipamentos', 'Medicamentos'].map((grupo) => (
            <div key={grupo} className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className="text-[9px] font-mono-custom text-faint uppercase tracking-wider w-24 flex-shrink-0">{grupo}</span>
              {EQUIPMENT_SHORTCUTS.filter((s) => s.grupo === grupo).map(({ label, term }) => (
                <button
                  key={term}
                  onClick={() => buscar(term)}
                  className={clsx(
                    'text-[10px] font-mono-custom px-2.5 py-1 rounded-full border transition-all',
                    query === term
                      ? 'bg-accent text-black border-accent font-bold'
                      : 'border-subtle2 text-muted hover:text-strong hover:bg-bg3'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
          <div className="mb-5" />

          {/* ── Estado inicial ───────────────────────────────────────────────── */}
          {!searched && (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center">
              <BarChart2 size={32} className="text-faint mx-auto mb-3" />
              <p className="text-[14px] text-strong font-medium mb-1">Painel de Preços — Compras.gov.br</p>
              <p className="text-[12px] text-faint max-w-md mx-auto">
                Consulte preços de referência praticados em contratos e atas de registro de preços
                do governo federal. Use os atalhos acima ou digite o nome do equipamento.
              </p>
            </div>
          )}

          {/* ── Loading ──────────────────────────────────────────────────────── */}
          {loading && (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Consultando Compras.gov.br…
            </div>
          )}

          {/* ── Results ──────────────────────────────────────────────────────── */}
          {!loading && searched && (
            <>
              {/* KPI strip */}
              {stats && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <KPICard
                    label="Preço médio" value={formatBRL(stats.valorMedio)}
                    sub={`mediana: ${formatBRL(stats.valorMediano)}`}
                    icon={BarChart2}
                  />
                  <KPICard
                    label="Menor preço" value={formatBRL(stats.valorMin)}
                    sub="referência mínima"
                    icon={TrendingDown} color="text-emerald-400"
                  />
                  <KPICard
                    label="Maior preço" value={formatBRL(stats.valorMax)}
                    sub="referência máxima"
                    icon={TrendingUp} color="text-brand-red"
                  />
                  <KPICard
                    label="Fornecedores" value={String(stats.fornecedoresUnicos)}
                    sub={`${stats.orgaosUnicos} órgãos`}
                    icon={Users}
                  />
                </div>
              )}

              {/* CATMAT codes for the searched term */}
              {query && (
                <div className="bg-bg2 border border-subtle rounded-xl px-4 py-3 mb-4">
                  <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">
                    Catálogo de Materiais (CATMAT)
                  </div>
                  <CatmatPanel term={query} />
                </div>
              )}

              {precos.length === 0 ? (
                <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
                  Nenhum registro encontrado no Compras.gov para "{query}".
                  <br />
                  <span className="text-[11px] mt-1 block">
                    Tente um termo mais amplo (ex: "tomografia" em vez de "tomógrafo computadorizado").
                  </span>
                </div>
              ) : (

                /* ── Tabela de preços ──────────────────────────────────────── */
                <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-subtle bg-bg3/20">
                    <span className="text-[11px] font-mono-custom text-faint">
                      {sorted.length} registro{sorted.length !== 1 ? 's' : ''}
                    </span>
                    <ExportButton
                      data={sorted}
                      filename={`precos-${query}`}
                      title={`Preços de Referência — ${query}`}
                      columns={[
                        { key: 'descricaoItem', label: 'Descrição' },
                        { key: 'razaoSocialFornecedor', label: 'Fornecedor' },
                        { key: 'cnpjFornecedor', label: 'CNPJ Fornecedor' },
                        { key: 'nomeOrgao', label: 'Órgão' },
                        { key: 'siglaUf', label: 'UF' },
                        { key: 'marca', label: 'Marca' },
                        { key: 'valorUnitario', label: 'Valor Unitário', format: (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                        { key: 'quantidade', label: 'Quantidade' },
                        { key: 'unidadeMedida', label: 'Unidade' },
                        { key: 'dataResultado', label: 'Data' },
                        { key: 'esfera', label: 'Esfera' },
                        { key: 'tipoCompra', label: 'Tipo' },
                      ]}
                    />
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-subtle bg-bg3/40">
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Descrição</th>
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Fornecedor</th>
                        <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Órgão</th>
                        <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">UF</th>
                        <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5 cursor-pointer select-none"
                          onClick={() => toggleSort('data')}>
                          Data <SortIcon col="data" />
                        </th>
                        <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5 cursor-pointer select-none"
                          onClick={() => toggleSort('valor')}>
                          Valor unit. <SortIcon col="valor" />
                        </th>
                        <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p, idx) => {
                        const isOpen = expanded.has(p.id)
                        return (
                          <React.Fragment key={`${p.id}-${idx}`}>
                            <tr
                              className={clsx(
                                'border-b border-subtle transition-colors cursor-pointer',
                                isOpen ? 'bg-bg3' : 'hover:bg-bg3'
                              )}
                              onClick={() => toggle(p.id)}
                            >
                              {/* Descrição — nome completo do equipamento */}
                              <td className="px-4 py-2.5 align-top">
                                <div className="text-[12px] text-strong max-w-[360px] leading-snug" title={p.descricaoItem}>
                                  {p.descricaoItem || '—'}
                                </div>
                                {p.codigoItem && (
                                  <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                                    CATMAT {p.codigoItem}
                                  </div>
                                )}
                              </td>

                              {/* Fornecedor */}
                              <td className="px-3 py-2.5">
                                <div className="text-[11px] text-strong max-w-[160px] truncate">
                                  {p.razaoSocialFornecedor || '—'}
                                </div>
                                {p.cnpjFornecedor && (
                                  <div className="text-[9px] font-mono-custom text-faint">
                                    {formatCNPJ(p.cnpjFornecedor)}
                                  </div>
                                )}
                              </td>

                              {/* Órgão */}
                              <td className="px-3 py-2.5">
                                <div className="text-[11px] text-muted max-w-[160px] truncate">{p.nomeOrgao || '—'}</div>
                              </td>

                              {/* UF */}
                              <td className="px-3 py-2.5 text-center">
                                <span className="text-[11px] font-mono-custom text-faint">{p.siglaUf || '—'}</span>
                              </td>

                              {/* Data */}
                              <td className="px-3 py-2.5 text-center">
                                <span className="text-[11px] font-mono-custom text-muted">{formatDate(p.dataResultado)}</span>
                              </td>

                              {/* Valor */}
                              <td className="px-4 py-2.5 text-right">
                                <div className="text-[14px] font-mono-custom font-bold text-strong">
                                  {formatBRL(p.valorUnitario)}
                                </div>
                                <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                                  {p.quantidade > 1 && `${p.quantidade} ${p.unidadeMedida} · total ${formatBRL(p.valorTotal)}`}
                                  {p.quantidade === 1 && p.unidadeMedida && `/${p.unidadeMedida}`}
                                </div>
                              </td>

                              {/* Tipo de compra (Pública/Privada) + esfera */}
                              <td className="px-3 py-2.5 text-center">
                                <span className={clsx(
                                  'text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                                  p.tipoCompra === 'privada'
                                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                    : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                )}>
                                  {p.tipoCompra === 'privada' ? 'Privada' : 'Pública'}
                                </span>
                                {p.esfera && (
                                  <div className="text-[9px] font-mono-custom text-faint mt-0.5">{p.esfera}</div>
                                )}
                              </td>
                            </tr>

                            {isOpen && (
                              <tr className="border-b border-subtle bg-bg3/40">
                                <td colSpan={7} className="px-6 py-4">
                                  {/* Nome completo do equipamento */}
                                  <div className="mb-4 pb-3 border-b border-subtle">
                                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Equipamento (descrição completa)</div>
                                    <div className="text-[13px] text-strong leading-snug">{p.descricaoItem || '—'}</div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-6 text-[12px]">
                                    <div className="space-y-2">
                                      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Detalhes do item</div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-24 flex-shrink-0">Código CATMAT</span>
                                        <span className="font-mono-custom text-strong">{p.codigoItem || '—'}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-24 flex-shrink-0">Unidade</span>
                                        <span className="text-strong">{p.unidadeMedida || '—'}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-24 flex-shrink-0">Quantidade</span>
                                        <span className="font-mono-custom text-strong">{p.quantidade}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-24 flex-shrink-0">Valor total</span>
                                        <span className="font-mono-custom font-bold text-accent">{formatBRL(p.valorTotal)}</span>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Fornecedor</div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-20 flex-shrink-0">Empresa</span>
                                        <span className="text-strong">{p.razaoSocialFornecedor || '—'}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-20 flex-shrink-0">CNPJ</span>
                                        <span className="font-mono-custom text-muted">{formatCNPJ(p.cnpjFornecedor) || '—'}</span>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Compra</div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-20 flex-shrink-0">Tipo</span>
                                        <span className={clsx(
                                          'text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase',
                                          p.tipoCompra === 'privada'
                                            ? 'bg-amber-500/15 text-amber-400'
                                            : 'bg-emerald-500/15 text-emerald-400'
                                        )}>
                                          {p.tipoCompra === 'privada' ? 'Compra Privada' : 'Compra Pública'}
                                        </span>
                                      </div>
                                      {p.marca && (
                                        <div className="flex gap-2">
                                          <span className="text-faint w-20 flex-shrink-0">Marca</span>
                                          <span className="text-strong">{p.marca}</span>
                                        </div>
                                      )}
                                      {(p.esfera || p.poder) && (
                                        <div className="flex gap-2">
                                          <span className="text-faint w-20 flex-shrink-0">Esfera</span>
                                          <span className="text-muted">{[p.esfera, p.poder].filter(Boolean).join(' · ')}</span>
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <span className="text-faint w-20 flex-shrink-0">Data</span>
                                        <span className="font-mono-custom text-strong">{formatDate(p.dataResultado)}</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <span className="text-faint w-20 flex-shrink-0">Órgão</span>
                                        <span className="text-strong">{p.nomeOrgao}</span>
                                      </div>
                                      {p.municipio && (
                                        <div className="flex gap-2">
                                          <span className="text-faint w-20 flex-shrink-0">Município</span>
                                          <span className="text-muted">{p.municipio} / {p.siglaUf}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Footer */}
                  <div className="px-4 py-3 border-t border-subtle flex items-center justify-between">
                    <span className="text-[10px] font-mono-custom text-faint">
                      {sorted.length} registros · Fonte: Painel de Preços — Compras.gov.br
                    </span>
                    <a
                      href="https://www.compras.gov.br/painel-de-precos"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] font-mono-custom text-faint hover:text-accent transition-colors"
                    >
                      <ExternalLink size={10} />
                      Ver no Compras.gov
                    </a>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
