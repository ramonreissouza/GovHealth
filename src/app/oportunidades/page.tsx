'use client'
// src/app/oportunidades/page.tsx — Análise Vencedores (referencia1)

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { Oportunidade } from '@/lib/types'
import type { ItemPNCP } from '@/lib/pncp'
import { clsx } from 'clsx'
import { Search, ExternalLink, Calendar, Hash, ChevronDown, ChevronUp, LayoutList, Table2, Package, Building2, Newspaper, Target } from 'lucide-react'
import { ExportButton } from '@/components/ui/ExportButton'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { PrecosReferencia } from '@/components/ui/PrecosReferencia'
import { AddToCRMButton } from '@/components/ui/AddToCRMButton'
import { AbrirDossieButton } from '@/components/ui/AbrirDossieButton'
import { CATEGORIA_LABEL_CURTO as CATEGORIA_LABEL, CATEGORIA_COLOR, TIPO_LABEL as TIPO_LABEL_BASE } from '@/lib/categorias'
import { formatBRL, formatDate, diasRestantes } from '@/lib/format'
import { getProdutos, casaComPortfolio, type ProdutoPortfolio } from '@/lib/portfolio'
import { publishDataStatus } from '@/lib/data-status'

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIAS = ['todos', 'imagem', 'uti', 'laboratorio', 'cirurgia', 'oncologia', 'medicamento', 'outros']

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ANOS = ['todos','2026','2025','2024','2023']

const SITUACAO_CLASS: Record<number, string> = {
  1: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  2: 'bg-amber/15 text-amber border border-amber/30',
  3: 'bg-red/15 text-red border border-red/30',
  4: 'bg-bg4 text-faint border border-subtle2',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCNPJ(s: string) {
  if (!s || s.length !== 14) return s
  return `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}`
}

function parsePNCPNum(num?: string): { cnpj: string; ano: number; seq: number } | null {
  if (!num) return null
  const parts = num.split('-')
  // format: {cnpj14}-{ano4}-{seq6}-{suffix}
  if (parts.length < 3 || parts[0].length < 14) return null
  const ano = Number(parts[1])
  const seq = Number(parts[2])
  if (!ano || !seq) return null
  return { cnpj: parts[0], ano, seq }
}

// "Em aberto" = prazo de proposta ainda no futuro. O PNCP às vezes mantém
// situacaoCompraId=1 mesmo após o prazo vencer, então a data de encerramento
// (quando existe) é a fonte de verdade. Usada tanto no filtro quanto no KPI.
function estaAberta(o: Oportunidade): boolean {
  const lic = o.licitacaoRelacionada
  return lic?.dataEncerramentoProposta
    ? new Date(lic.dataEncerramentoProposta) > new Date()
    : lic?.situacaoCompraId === 1
}

// ── ItemsRow: lazy-loads PNCP items for a given oportunidade ─────────────────

function ItemsRow({ opp }: { opp: Oportunidade }) {
  const [itens, setItens] = useState<ItemPNCP[]>([])
  const [loading, setLoading] = useState(true)

  const lic = opp.licitacaoRelacionada

  useEffect(() => {
    const parsed = parsePNCPNum(lic?.numeroControlePNCP)
    const cnpj = lic?.orgaoEntidade?.cnpj
    if (!parsed || !cnpj) { setLoading(false); return }

    fetch(`/api/itens?cnpj=${cnpj}&ano=${parsed.ano}&seq=${parsed.seq}`)
      .then((r) => r.json())
      .then((json) => setItens(json.itens ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [opp.id, lic?.numeroControlePNCP, lic?.orgaoEntidade?.cnpj])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-faint py-1">
        <Package size={12} className="animate-pulse" />
        Buscando equipamentos no PNCP…
      </div>
    )
  }

  if (itens.length === 0) return null

  return (
    <div className="mt-3">
      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Package size={11} />
        Equipamentos licitados ({itens.length} iten{itens.length !== 1 ? 's' : ''})
      </div>
      <div className="space-y-1">
        {itens.map((item) => (
          <div key={item.numeroItem} className="flex items-start gap-3 px-3 py-2 bg-bg4/40 rounded-lg">
            <span className="text-[9px] font-mono-custom text-faint w-4 flex-shrink-0 mt-0.5">{item.numeroItem}</span>
            <span className="text-[11px] text-strong flex-1 leading-snug">{item.descricao}</span>
            <span className="text-[10px] font-mono-custom text-faint flex-shrink-0 whitespace-nowrap">
              {item.quantidade} {item.unidadeMedida}
            </span>
            <span className="text-[11px] font-mono-custom font-bold text-accent flex-shrink-0 whitespace-nowrap">
              {formatBRL(item.quantidade * item.valorUnitarioEstimado)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Abas de tipo: 'todos' (só UI) + os TipoFornecimento da fonte única (categorias.ts).
const TIPO_LABEL: Record<string, string> = { todos: 'Todos', ...TIPO_LABEL_BASE }
const TIPOS: { key: string; label: string }[] =
  Object.entries(TIPO_LABEL).map(([key, label]) => ({ key, label }))

function OportunidadesInner() {
  const searchParams = useSearchParams()
  const [opps, setOpps] = useState<Oportunidade[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [tipo, setTipo] = useState(searchParams.get('tipo') ?? 'todos')
  const [query, setQuery] = useState('')
  const [queryProponente, setQueryProponente] = useState('')
  const [queryConvenio, setQueryConvenio] = useState('')
  const [categoria, setCategoria] = useState('todos')
  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const [anoFiltro, setAnoFiltro] = useState('todos')
  const [statusFiltro, setStatusFiltro] = useState('todos')
  const [minScore, setMinScore] = useState(0)
  const [viewMode, setViewMode] = useState<'tabela' | 'cards'>('tabela')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [produtos, setProdutos] = useState<ProdutoPortfolio[]>([])
  const [soPortfolio, setSoPortfolio] = useState(false)

  // Carrega o portfólio do fornecedor (localStorage) para o filtro "Meu Portfólio".
  useEffect(() => { setProdutos(getProdutos()) }, [])
  const temPortfolio = produtos.some((p) => p.ativo)

  // Deep-link vindo do dashboard (?opp=<id>): expande, rola e destaca a oportunidade.
  const focusId = searchParams.get('opp')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId || loading || opps.length === 0) return
    if (!opps.some((o) => o.id === focusId)) return
    setExpanded((p) => new Set(p).add(focusId))
    setHighlightId(focusId)
    const t = setTimeout(() => {
      document.getElementById(`opp-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    const t2 = setTimeout(() => setHighlightId(null), 2600)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [focusId, loading, opps])

  const toggle = (id: string) =>
    setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })

  const toggleUF = (uf: string) =>
    setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '300' })
      if (minScore > 0) params.set('minScore', String(minScore))
      if (categoria !== 'todos') params.set('categoria', categoria)
      const res = await fetch(`/api/opportunities?${params}`)
      const data = await res.json()
      publishDataStatus(data)
      setOpps(data.oportunidades ?? [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [categoria, minScore])

  useEffect(() => { load() }, [load])

  // Sincroniza a aba de tipo quando a URL muda (links da sidebar "Por Tipo")
  useEffect(() => { setTipo(searchParams.get('tipo') ?? 'todos') }, [searchParams])

  // Client-side filtering
  const filtered = opps.filter((o) => {
    if (tipo !== 'todos' && (o.tipoFornecimento ?? 'outros') !== tipo) return false
    if (soPortfolio && !casaComPortfolio(produtos, o)) return false
    const lic = o.licitacaoRelacionada
    if (ufsAtivos.size > 0 && !ufsAtivos.has(o.uf)) return false
    if (anoFiltro !== 'todos' && lic?.dataPublicacaoPncp?.substring(0, 4) !== anoFiltro) return false
    if (statusFiltro === 'aberto' && !estaAberta(o)) return false
    if (statusFiltro === 'encerrado' && estaAberta(o)) return false
    if (queryProponente && !(o.hospital ?? o.municipio).toLowerCase().includes(queryProponente.toLowerCase())) return false
    if (queryConvenio && !(lic?.numeroControlePNCP ?? '').toLowerCase().includes(queryConvenio.toLowerCase())) return false
    if (query) {
      const q = query.toLowerCase()
      return (
        (o.hospital ?? '').toLowerCase().includes(q) ||
        o.municipio.toLowerCase().includes(q) ||
        o.descricao.toLowerCase().includes(q) ||
        (lic?.orgaoEntidade.cnpj ?? '').includes(q) ||
        (lic?.numeroControlePNCP ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // KPIs
  const valorTotal = filtered.reduce((s, o) => s + o.valorEstimado, 0)
  const ticketMedio = filtered.length ? valorTotal / filtered.length : 0
  const estados = new Set(filtered.map((o) => o.uf)).size
  const abertos = filtered.filter(estaAberta).length

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title={tipo === 'todos' ? 'Análise de Licitações' : `Licitações · ${TIPO_LABEL[tipo] ?? tipo}`}
          subtitle={loading ? 'Carregando…' : `${filtered.length} encontradas`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* ── Abas por tipo de fornecimento ────────────────────────────── */}
          <div className="flex gap-1 mb-4 border-b border-subtle overflow-x-auto">
            {TIPOS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTipo(t.key)}
                className={clsx(
                  'text-[12px] font-mono-custom px-3 py-2 whitespace-nowrap border-b-2 -mb-px transition-all',
                  tipo === t.key
                    ? 'border-accent text-accent font-bold'
                    : 'border-transparent text-muted hover:text-strong'
                )}
              >
                {t.label}
                <span className="ml-1.5 text-[10px] text-faint">
                  {t.key === 'todos'
                    ? opps.length
                    : opps.filter((o) => (o.tipoFornecimento ?? 'outros') === t.key).length}
                </span>
              </button>
            ))}
          </div>

          {/* ── KPI strip ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Valor total', value: formatBRL(valorTotal), sub: 'estimado' },
              { label: 'Ticket médio', value: formatBRL(ticketMedio), sub: 'por licitação' },
              { label: 'Em aberto', value: String(abertos), sub: `de ${filtered.length} total` },
              { label: 'Estados', value: String(estados), sub: 'com resultados' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className="text-[20px] font-mono-custom font-bold text-strong mt-0.5 leading-tight">{value}</div>
                <div className="text-[10px] text-faint font-mono-custom mt-0.5">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Year tabs + Status + Score + View toggle ─────────────────── */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* Year */}
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1">
              {ANOS.map((ano) => (
                <button key={ano} onClick={() => setAnoFiltro(ano)}
                  className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                    anoFiltro === ano ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                  {ano === 'todos' ? 'Todos' : ano}
                </button>
              ))}
            </div>

            {/* Status */}
            <div className="flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1">
              {[{ k: 'todos', l: 'Todos' }, { k: 'aberto', l: 'Aberto' }, { k: 'encerrado', l: 'Encerrado' }].map(({ k, l }) => (
                <button key={k} onClick={() => setStatusFiltro(k)}
                  className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-md transition-all',
                    statusFiltro === k ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong')}>
                  {l}
                </button>
              ))}
            </div>

            {/* Score filter */}
            <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}
              className="text-[11px] font-mono-custom bg-bg2 border border-subtle2 rounded-lg px-3 py-2 text-strong outline-none cursor-pointer">
              <option value={0}>Todos os scores</option>
              <option value={50}>Score ≥ 50</option>
              <option value={70}>Score ≥ 70</option>
              <option value={80}>Score ≥ 80</option>
            </select>

            {/* Meu Portfólio — casa as oportunidades com os produtos cadastrados */}
            <button
              onClick={() => setSoPortfolio((v) => !v)}
              disabled={!temPortfolio}
              title={temPortfolio ? 'Mostrar só oportunidades que casam com o seu portfólio' : 'Cadastre produtos em Meu Portfólio para usar este filtro'}
              className={clsx(
                'flex items-center gap-1.5 text-[11px] font-mono-custom px-3 py-2 rounded-lg border transition-all',
                soPortfolio
                  ? 'bg-accent text-black border-accent font-bold'
                  : 'bg-bg2 border-subtle2 text-muted hover:text-strong',
                !temPortfolio && 'opacity-40 cursor-not-allowed',
              )}
            >
              <Target size={13} />
              Meu Portfólio
            </button>

            <ExportButton
              data={filtered}
              filename="licitacoes"
              title="Licitações GovHealth AI"
              columns={[
                { key: 'descricao', label: 'Descrição' },
                { key: 'categoria', label: 'Categoria' },
                { key: 'uf', label: 'UF' },
                { key: 'municipio', label: 'Município' },
                { key: 'score', label: 'Score' },
                { key: 'valorEstimado', label: 'Valor Estimado', format: (v) => `R$ ${Number(v).toLocaleString('pt-BR')}` },
                { key: 'status', label: 'Status' },
                { key: 'urgencia', label: 'Urgência' },
              ]}
            />

            {/* View toggle */}
            <div className="ml-auto flex gap-0.5 bg-bg2 border border-subtle2 rounded-lg p-1">
              <button onClick={() => setViewMode('tabela')}
                className={clsx('p-1.5 rounded-md transition-all', viewMode === 'tabela' ? 'bg-bg4 text-strong' : 'text-faint hover:text-strong')}
                title="Tabela">
                <Table2 size={14} />
              </button>
              <button onClick={() => setViewMode('cards')}
                className={clsx('p-1.5 rounded-md transition-all', viewMode === 'cards' ? 'bg-bg4 text-strong' : 'text-faint hover:text-strong')}
                title="Cards">
                <LayoutList size={14} />
              </button>
            </div>
          </div>

          {/* ── UF bar (multi-select) ─────────────────────────────────────── */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setUfsAtivos(new Set())}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todos
              </button>
              {UFS.map((uf) => (
                <button key={uf} onClick={() => toggleUF(uf)}
                  className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                    ufsAtivos.has(uf) ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                  {uf}
                </button>
              ))}
            </div>
          </div>

          {/* ── Category row ─────────────────────────────────────────────── */}
          <div className="flex gap-2 flex-wrap mb-2">
            {CATEGORIAS.map((cat) => (
              <button key={cat} onClick={() => setCategoria(cat)}
                className={clsx('text-[11px] font-mono-custom px-3 py-1.5 rounded-full border transition-all',
                  categoria === cat ? 'bg-accent text-black border-accent' : 'border-subtle2 text-muted hover:text-strong hover:bg-bg3')}>
                {cat === 'todos' ? 'Todas categorias' : CATEGORIA_LABEL[cat]}
              </button>
            ))}
          </div>

          {/* ── 3 search boxes ───────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { value: queryProponente, set: setQueryProponente, placeholder: 'Nome do proponente / hospital…' },
              { value: query, set: setQuery, placeholder: 'Busca geral (município, CNPJ…)' },
              { value: queryConvenio, set: setQueryConvenio, placeholder: 'Nº PNCP / convênio…' },
            ].map(({ value, set, placeholder }) => (
              <div key={placeholder} className="flex items-center gap-2 bg-bg2 border border-subtle2 rounded-lg px-3 py-2">
                <Search size={13} className="text-faint flex-shrink-0" />
                <input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                  className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none" />
              </div>
            ))}
          </div>

          {/* ── Content ──────────────────────────────────────────────────── */}
          {loading ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Carregando dados de 2023–2025… pode levar até 25 segundos na primeira vez.
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Nenhuma oportunidade encontrada com os filtros aplicados.
            </div>
          ) : viewMode === 'tabela' ? (

            /* ── TABLE VIEW ─────────────────────────────────────────────── */
            <div className="bg-bg2 border border-subtle rounded-xl">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-subtle bg-bg3/30">
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5 w-7">#</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Proponente</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Convênio / PNCP</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Status</th>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Item</th>
                    <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor</th>
                    <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Ano</th>
                    <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((opp, idx) => {
                    const lic = opp.licitacaoRelacionada
                    const situacaoId = lic?.situacaoCompraId ?? 4
                    const ano = lic?.dataPublicacaoPncp?.substring(0, 4) ?? '—'
                    const dias = lic?.dataEncerramentoProposta ? diasRestantes(lic.dataEncerramentoProposta) : null
                    const isExpanded = expanded.has(opp.id)
                    return (
                      <React.Fragment key={opp.id}>
                        <tr
                          id={`opp-${opp.id}`}
                          className={clsx('border-b border-subtle transition-colors cursor-pointer',
                            highlightId === opp.id ? 'ring-2 ring-accent ring-inset bg-accent/5' : isExpanded ? 'bg-bg3' : 'hover:bg-bg3')}
                          onClick={() => toggle(opp.id)}>
                          <td className="px-3 py-2.5 text-[10px] text-faint font-mono-custom">{idx + 1}</td>
                          <td className="px-4 py-2.5">
                            <div className="text-[12px] font-medium text-strong">{opp.hospital ?? opp.municipio}</div>
                            <div className="text-[9px] text-faint font-mono-custom">{opp.municipio} / {opp.uf}
                              {lic?.orgaoEntidade.cnpj && ` · ${formatCNPJ(lic.orgaoEntidade.cnpj)}`}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-[10px] font-mono-custom text-muted max-w-[130px] truncate">
                              {lic?.numeroControlePNCP ?? '—'}
                            </div>
                            {lic?.modalidadeNome && <div className="text-[9px] text-faint">{lic.modalidadeNome}</div>}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide block w-fit',
                              SITUACAO_CLASS[situacaoId as keyof typeof SITUACAO_CLASS] ?? SITUACAO_CLASS[4])}>
                              {lic?.situacaoCompraNome ?? 'Encerrado'}
                            </span>
                            {dias !== null && dias > 0 && (
                              <span className="text-[9px] font-mono-custom mt-0.5 block text-emerald-400">{dias}d restantes</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase flex-shrink-0', CATEGORIA_COLOR[opp.categoria])}>
                                {CATEGORIA_LABEL[opp.categoria]}
                              </span>
                              <span className="text-[11px] text-muted max-w-[160px] truncate">{opp.descricao}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="text-[13px] font-mono-custom font-bold text-strong">{formatBRL(opp.valorEstimado)}</div>
                            <div className={clsx('text-[9px] font-mono-custom uppercase mt-0.5',
                              opp.urgencia === 'urgente' ? 'text-brand-red' : opp.urgencia === 'alta' ? 'text-amber' : opp.urgencia === 'media' ? 'text-brand-blue' : 'text-faint')}>
                              {opp.urgencia}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center text-[10px] font-mono-custom text-faint">{ano}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex justify-center">
                              <ScoreBadge score={opp.score} status={opp.status} subScores={opp.subScores} acaoRecomendada={opp.acaoRecomendada} size="sm" side="left" />
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-subtle bg-bg3/40">
                            <td colSpan={8} className="px-6 py-4">
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-3">
                                  <div>
                                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Objeto completo</div>
                                    <p className="text-[12px] text-strong leading-relaxed">{lic?.objetoCompra ?? opp.descricao}</p>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Ação recomendada</div>
                                    <p className="text-[12px] text-accent leading-relaxed">{opp.acaoRecomendada}</p>
                                  </div>
                                  {lic?.linkSistemaOrigem && (
                                    <a href={lic.linkSistemaOrigem} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-[11px] text-faint hover:text-accent transition-colors"
                                      onClick={(e) => e.stopPropagation()}>
                                      <ExternalLink size={12} />
                                      Ver edital completo no sistema de origem
                                    </a>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <AddToCRMButton oportunidade={opp} />
                                    <AbrirDossieButton oportunidade={opp} />
                                  </div>
                                  <ItemsRow opp={opp} />
                                  <div className="mt-3 pt-3 border-t border-subtle">
                                    <PrecosReferencia termo={opp.descricao} uf={opp.uf} />
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  <div>
                                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Datas</div>
                                    <div className="space-y-1.5">
                                      {[
                                        { label: 'Publicação', value: formatDate(lic?.dataPublicacaoPncp) },
                                        { label: 'Encerramento', value: formatDate(lic?.dataEncerramentoProposta) },
                                      ].map(({ label, value }) => (
                                        <div key={label} className="flex items-center gap-2 text-[12px]">
                                          <Calendar size={11} className="text-faint flex-shrink-0" />
                                          <span className="text-faint">{label}:</span>
                                          <span className="font-mono-custom text-strong">{value}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Score breakdown</div>
                                    <div className="space-y-1">
                                      {(Object.entries(opp.subScores) as [string, number][]).map(([key, val]) => (
                                        <div key={key} className="flex items-center gap-2">
                                          <span className="text-[10px] text-faint font-mono-custom w-20 capitalize">{key}</span>
                                          <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden">
                                            <div className="h-full rounded-full bg-accent" style={{ width: `${val}%` }} />
                                          </div>
                                          <span className="text-[10px] font-mono-custom text-strong w-6 text-right">{val}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  {/* CNES info */}
                                  {(opp.cnesLeitos != null || opp.cnesCategoriaHospital) && (
                                    <div>
                                      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                        <Building2 size={10} />
                                        CNES — Dados do Hospital
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {opp.cnesLeitos != null && (
                                          <span className="text-[10px] font-mono-custom bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded px-2 py-0.5">
                                            {opp.cnesLeitos} leitos
                                          </span>
                                        )}
                                        {opp.cnesCategoriaHospital && (
                                          <span className="text-[10px] font-mono-custom bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded px-2 py-0.5 capitalize">
                                            {opp.cnesCategoriaHospital}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {/* DOU badge */}
                                  {opp.id.startsWith('dou-') && (
                                    <div className="flex items-center gap-1.5 bg-amber/5 border border-amber/20 rounded-lg px-2.5 py-1.5">
                                      <Newspaper size={11} className="text-amber flex-shrink-0" />
                                      <span className="text-[11px] text-amber">Pré-edital detectado no DOU — agir antes da publicação formal</span>
                                    </div>
                                  )}
                                  {lic?.numeroControlePNCP && (
                                    <div className="flex items-center gap-1.5">
                                      <Hash size={10} className="text-faint" />
                                      <span className="text-[11px] font-mono-custom text-muted">{lic.numeroControlePNCP}</span>
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
            </div>

          ) : (

            /* ── CARDS VIEW ─────────────────────────────────────────────── */
            <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
              {filtered.map((opp) => {
                const lic = opp.licitacaoRelacionada
                const isExpanded = expanded.has(opp.id)
                const dias = lic?.dataEncerramentoProposta ? diasRestantes(lic.dataEncerramentoProposta) : null
                const situacaoId = lic?.situacaoCompraId ?? 4
                const anoRef = lic?.dataPublicacaoPncp?.substring(0, 4) ?? '—'

                return (
                  <div key={opp.id} id={`opp-${opp.id}`} className={clsx('border-b border-subtle last:border-0',
                    highlightId === opp.id && 'ring-2 ring-accent ring-inset bg-accent/5')}>
                    <div className="flex items-start gap-3 px-4 py-3 hover:bg-bg3 cursor-pointer transition-colors"
                      onClick={() => toggle(opp.id)}>
                      <div className="mt-0.5">
                        <ScoreBadge score={opp.score} status={opp.status} subScores={opp.subScores} acaoRecomendada={opp.acaoRecomendada} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-semibold text-strong">{opp.hospital ?? opp.municipio}</span>
                          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                            SITUACAO_CLASS[situacaoId as keyof typeof SITUACAO_CLASS] ?? SITUACAO_CLASS[4])}>
                            {lic?.situacaoCompraNome ?? 'Encerrado'}
                          </span>
                          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide', CATEGORIA_COLOR[opp.categoria])}>
                            {CATEGORIA_LABEL[opp.categoria]}
                          </span>
                          {dias !== null && dias > 0 && (
                            <span className="text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                              {dias}d restantes
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-faint font-mono-custom">{opp.municipio} / {opp.uf}</span>
                          {lic?.orgaoEntidade.cnpj && <span className="text-[11px] text-faint font-mono-custom">· CNPJ {formatCNPJ(lic.orgaoEntidade.cnpj)}</span>}
                          {lic?.modalidadeNome && <span className="text-[11px] text-faint">· {lic.modalidadeNome}</span>}
                          <span className="text-[11px] text-faint">· {anoRef}</span>
                        </div>

                        <p className="text-[12px] text-muted mt-1 leading-snug line-clamp-2">{opp.descricao}</p>
                      </div>

                      <div className="flex-shrink-0 text-right ml-2">
                        <div className="text-[15px] font-mono-custom font-bold text-strong">{formatBRL(opp.valorEstimado)}</div>
                        <div className={clsx('text-[10px] font-mono-custom uppercase mt-0.5',
                          opp.urgencia === 'urgente' ? 'text-brand-red' : opp.urgencia === 'alta' ? 'text-amber' : opp.urgencia === 'media' ? 'text-brand-blue' : 'text-faint')}>
                          {opp.urgencia}
                        </div>
                        <div className="mt-1.5 text-faint">{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0 bg-bg3/50 border-t border-subtle">
                        <div className="mt-3 grid grid-cols-2 gap-4 pl-[52px]">
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Objeto completo</div>
                              <p className="text-[12px] text-strong leading-relaxed">{lic?.objetoCompra ?? opp.descricao}</p>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Ação recomendada</div>
                              <p className="text-[12px] text-accent leading-relaxed">{opp.acaoRecomendada}</p>
                            </div>
                            {lic?.linkSistemaOrigem && (
                              <a href={lic.linkSistemaOrigem} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] text-faint hover:text-accent transition-colors"
                                onClick={(e) => e.stopPropagation()}>
                                <ExternalLink size={12} />
                                Ver edital completo no sistema de origem
                              </a>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                              <AddToCRMButton oportunidade={opp} />
                              <AbrirDossieButton oportunidade={opp} />
                            </div>
                            <ItemsRow opp={opp} />
                            <div className="mt-3 pt-3 border-t border-subtle">
                              <PrecosReferencia termo={opp.descricao} uf={opp.uf} />
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Datas</div>
                              <div className="space-y-1">
                                {[
                                  { label: 'Publicação', value: formatDate(lic?.dataPublicacaoPncp), color: 'text-strong' },
                                  { label: 'Encerramento', value: formatDate(lic?.dataEncerramentoProposta), color: dias !== null && dias > 0 ? 'text-emerald-400' : 'text-strong' },
                                ].map(({ label, value, color }) => (
                                  <div key={label} className="flex items-center gap-2 text-[12px]">
                                    <Calendar size={11} className="text-faint flex-shrink-0" />
                                    <span className="text-faint">{label}:</span>
                                    <span className={clsx('font-mono-custom', color)}>{value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5">Score breakdown</div>
                              <div className="space-y-1">
                                {(Object.entries(opp.subScores) as [string, number][]).map(([key, val]) => (
                                  <div key={key} className="flex items-center gap-2">
                                    <span className="text-[10px] text-faint font-mono-custom w-20 capitalize">{key}</span>
                                    <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full bg-accent" style={{ width: `${val}%` }} />
                                    </div>
                                    <span className="text-[10px] font-mono-custom text-strong w-6 text-right">{val}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* CNES info — cards view */}
                            {(opp.cnesLeitos != null || opp.cnesCategoriaHospital) && (
                              <div>
                                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                  <Building2 size={10} />
                                  CNES — Hospital
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {opp.cnesLeitos != null && (
                                    <span className="text-[10px] font-mono-custom bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded px-2 py-0.5">
                                      {opp.cnesLeitos} leitos
                                    </span>
                                  )}
                                  {opp.cnesCategoriaHospital && (
                                    <span className="text-[10px] font-mono-custom bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded px-2 py-0.5 capitalize">
                                      {opp.cnesCategoriaHospital}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* DOU badge — cards view */}
                            {opp.id.startsWith('dou-') && (
                              <div className="flex items-center gap-1.5 bg-amber/5 border border-amber/20 rounded-lg px-2.5 py-1.5">
                                <Newspaper size={11} className="text-amber flex-shrink-0" />
                                <span className="text-[11px] text-amber">Pré-edital detectado no DOU</span>
                              </div>
                            )}
                            {lic?.numeroControlePNCP && (
                              <div className="flex items-center gap-1.5">
                                <Hash size={10} className="text-faint" />
                                <span className="text-[11px] font-mono-custom text-muted">{lic.numeroControlePNCP}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default function OportunidadesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-faint text-[13px]">Carregando…</div>}>
      <OportunidadesInner />
    </Suspense>
  )
}
