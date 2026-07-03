'use client'
// src/app/timeline/page.tsx — Timeline de Licitações (dados reais PNCP)

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import { ExternalLink, Loader2, Calendar, Clock, CheckCircle2, AlertCircle, XCircle, MapPin, ChevronRight } from 'lucide-react'
import type { Oportunidade } from '@/lib/types'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { CATEGORIA_LABEL_CURTO as CATEGORIA_LABEL, TIPO_LABEL } from '@/lib/categorias'
import { formatBRL, formatDate, diasRestantes } from '@/lib/format'
import { publishDataStatus } from '@/lib/data-status'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const TIPOS: { key: string; label: string }[] = [{ key: 'todos', label: 'Todos' }, ...Object.entries(TIPO_LABEL).map(([key, label]) => ({ key, label }))]

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIA_COLOR: Record<string, string> = {
  imagem:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
  uti:         'bg-red-500/15 text-red-400 border-red-500/30',
  laboratorio: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  cirurgia:    'bg-purple-500/15 text-purple-400 border-purple-500/30',
  oncologia:   'bg-green-500/15 text-green-400 border-green-500/30',
  medicamento: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  outros:      'bg-bg4 text-faint border-subtle2',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type StatusTipo = 'encerra-hoje' | 'urgente' | 'aberto' | 'encerrado'

function getStatus(opp: Oportunidade): StatusTipo {
  const dias = diasRestantes(opp.licitacaoRelacionada?.dataEncerramentoProposta)
  if (dias === null) return opp.licitacaoRelacionada?.situacaoCompraId === 1 ? 'aberto' : 'encerrado'
  if (dias <= 0) return 'encerrado'
  if (dias <= 2) return 'encerra-hoje'
  if (dias <= 7) return 'urgente'
  return 'aberto'
}

const STATUS_CONFIG: Record<StatusTipo, {
  label: string; icon: React.ElementType; dotClass: string; lineClass: string; badgeClass: string
}> = {
  'encerra-hoje': {
    label: 'Encerra hoje/amanhã',
    icon: AlertCircle,
    dotClass: 'bg-red border-red/50',
    lineClass: 'bg-red/30',
    badgeClass: 'bg-red/15 text-red border border-red/30',
  },
  urgente: {
    label: 'Urgente (≤ 7 dias)',
    icon: Clock,
    dotClass: 'bg-amber border-amber/50',
    lineClass: 'bg-amber/30',
    badgeClass: 'bg-amber/15 text-amber border border-amber/30',
  },
  aberto: {
    label: 'Em aberto',
    icon: CheckCircle2,
    dotClass: 'bg-accent border-accent/50',
    lineClass: 'bg-accent/20',
    badgeClass: 'bg-accent/10 text-accent border border-accent/30',
  },
  encerrado: {
    label: 'Encerrado',
    icon: XCircle,
    dotClass: 'bg-bg4 border-subtle2',
    lineClass: 'bg-subtle',
    badgeClass: 'bg-bg4 text-faint border border-subtle2',
  },
}

// Group by YYYY-MM
function groupByMonth(opps: Oportunidade[]) {
  const map = new Map<string, Oportunidade[]>()
  for (const o of opps) {
    const key = o.licitacaoRelacionada?.dataPublicacaoPncp?.substring(0, 7) ?? 'sem-data'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(o)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 8)
}

function monthLabel(key: string) {
  if (key === 'sem-data') return 'Sem data'
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long', year: 'numeric',
  })
}

// ── Timeline Card ─────────────────────────────────────────────────────────────

function TimelineCard({ opp }: { opp: Oportunidade }) {
  const router = useRouter()
  const lic = opp.licitacaoRelacionada
  const status = getStatus(opp)
  const cfg = STATUS_CONFIG[status]
  const dias = diasRestantes(lic?.dataEncerramentoProposta)
  const StatusIcon = cfg.icon

  return (
    <div className="relative pl-7">
      {/* Dot */}
      <div className={clsx('absolute left-0 top-3.5 w-3 h-3 rounded-full border-2 flex-shrink-0', cfg.dotClass)} />

      {/* Card — clicável: abre o detalhe completo em /oportunidades */}
      <div
        onClick={() => router.push(`/oportunidades?opp=${encodeURIComponent(opp.id)}`)}
        className={clsx(
        'group bg-bg2 border rounded-xl p-3.5 transition-all cursor-pointer hover:border-accent/40 hover:bg-bg2/70',
        status === 'encerra-hoje' ? 'border-red/30' :
        status === 'urgente' ? 'border-amber/30' :
        'border-subtle'
      )}>
        {/* Header */}
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-strong leading-snug truncate">
              {opp.hospital ?? lic?.orgaoEntidade.razaoSocial ?? opp.municipio}
            </div>
            <div className="text-[10px] font-mono-custom text-faint mt-0.5">
              {opp.municipio} / {opp.uf}
            </div>
          </div>
          <ScoreBadge
            score={opp.score}
            status={opp.status}
            subScores={opp.subScores}
            acaoRecomendada={opp.acaoRecomendada}
            size="sm"
          />
          <ChevronRight size={14} className="text-faint opacity-0 group-hover:opacity-100 group-hover:text-accent transition-all flex-shrink-0 mt-0.5" />
        </div>

        {/* Description */}
        <p className="text-[11px] text-muted leading-snug line-clamp-2 mb-2.5">{opp.descricao}</p>

        {/* Timeline steps */}
        <div className="flex items-center gap-1 mb-2.5">
          {/* Step 1: Publicado */}
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="text-[9px] font-mono-custom text-faint">
              Publicado {formatDate(lic?.dataPublicacaoPncp)}
            </span>
          </div>
          <div className="flex-1 h-px bg-subtle mx-1" />
          {/* Step 2: Prazo */}
          <div className="flex items-center gap-1">
            <div className={clsx('w-1.5 h-1.5 rounded-full',
              status === 'encerrado' ? 'bg-faint' :
              status === 'urgente' || status === 'encerra-hoje' ? 'bg-amber' : 'bg-accent/50'
            )} />
            <span className="text-[9px] font-mono-custom text-faint">
              Prazo {formatDate(lic?.dataEncerramentoProposta)}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border uppercase', CATEGORIA_COLOR[opp.categoria])}>
            {CATEGORIA_LABEL[opp.categoria]}
          </span>
          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full border uppercase', cfg.badgeClass)}>
            <StatusIcon size={8} className="inline mr-0.5" />
            {status === 'encerrado' ? 'Encerrado' :
             status === 'encerra-hoje' ? 'Encerra hoje' :
             dias !== null ? `${dias}d restantes` : cfg.label}
          </span>
          <span className="text-[11px] font-mono-custom font-bold text-accent ml-auto">
            {formatBRL(opp.valorEstimado)}
          </span>
          {lic?.linkSistemaOrigem && (
            <a
              href={lic.linkSistemaOrigem}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-faint hover:text-accent transition-colors"
            >
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: 'todos',         label: 'Todos' },
  { key: 'encerra-hoje',  label: 'Encerra hoje' },
  { key: 'urgente',       label: 'Urgente ≤7d' },
  { key: 'aberto',        label: 'Em aberto' },
  { key: 'encerrado',     label: 'Encerrado' },
]

export default function TimelinePage() {
  const [opps, setOpps] = useState<Oportunidade[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('todos')
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [uf, setUf] = useState('')
  const [tipo, setTipo] = useState('todos')

  const load = useCallback(async () => {
    setLoading(true)
    setSelectedMonth(null) // volta ao mês mais recente ao trocar filtro
    try {
      // limit alto para cobrir vários meses (antes 400 só trazia o mês mais recente).
      const params = new URLSearchParams({ limit: '2000', minScore: '0' })
      if (uf) params.set('uf', uf)
      if (tipo !== 'todos') params.set('tipo', tipo)
      const r = await fetch(`/api/opportunities?${params}`)
      const d = await r.json()
      publishDataStatus(d)
      setOpps(d.oportunidades ?? [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [uf, tipo])

  useEffect(() => { load() }, [load])

  const filtered = opps.filter((o) => {
    if (statusFilter === 'todos') return true
    return getStatus(o) === statusFilter
  })

  const grouped = groupByMonth(filtered)

  // Month selector keys
  const monthKeys = grouped.map(([k]) => k)
  const activeMonth = selectedMonth ?? monthKeys[0] ?? null
  const activeGroup = grouped.find(([k]) => k === activeMonth)?.[1] ?? []

  // KPIs
  const urgentes = opps.filter((o) => ['encerra-hoje', 'urgente'].includes(getStatus(o))).length
  const abertos  = opps.filter((o) => getStatus(o) === 'aberto').length
  const valorAberto = opps
    .filter((o) => getStatus(o) !== 'encerrado')
    .reduce((s, o) => s + o.valorEstimado, 0)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Timeline inteligente"
          subtitle={loading ? 'Carregando…' : `${opps.length} licitações · ${urgentes} urgentes`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Urgentes (≤7d)',  value: String(urgentes), color: 'text-amber' },
              { label: 'Em aberto',       value: String(abertos),  color: 'text-accent' },
              { label: 'Valor em aberto', value: formatBRL(valorAberto), color: 'text-strong' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className={clsx('text-[22px] font-mono-custom font-bold mt-0.5 leading-tight', color)}>
                  {loading ? '—' : value}
                </div>
              </div>
            ))}
          </div>

          {/* Filtros UF + Tipo */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <MapPin size={13} className="text-faint" />
              <select value={uf} onChange={(e) => setUf(e.target.value)}
                className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none">
                <option value="">Todas UFs</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {TIPOS.map((t) => (
                <button key={t.key} onClick={() => setTipo(t.key)}
                  className={clsx('text-[11px] font-mono-custom px-2.5 py-1 rounded-full whitespace-nowrap transition-all border',
                    tipo === t.key ? 'bg-accent text-black border-accent font-bold' : 'border-subtle2 text-faint hover:text-strong')}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 mb-4 bg-bg2 border border-subtle2 rounded-xl p-1 w-fit">
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStatusFilter(opt.key)}
                className={clsx(
                  'text-[11px] font-mono-custom px-3 py-1.5 rounded-lg transition-all',
                  statusFilter === opt.key ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={22} className="animate-spin text-faint" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-faint text-[13px]">
              Nenhuma licitação encontrada com o filtro selecionado.
            </div>
          ) : (
            <div className="flex gap-5">
              {/* Month nav */}
              <div className="flex flex-col gap-1 flex-shrink-0 w-28">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider mb-1 px-2">Mês</div>
                {monthKeys.map((key) => (
                  <button
                    key={key}
                    onClick={() => setSelectedMonth(key)}
                    className={clsx(
                      'text-left px-2 py-2 rounded-lg text-[11px] transition-all leading-snug',
                      key === activeMonth
                        ? 'bg-accent/10 text-accent border border-accent/30'
                        : 'text-muted hover:text-strong hover:bg-bg3'
                    )}
                  >
                    <div className="capitalize">{monthLabel(key)}</div>
                    <div className="text-[9px] font-mono-custom text-faint mt-0.5">
                      {grouped.find(([k]) => k === key)?.[1].length ?? 0} licitações
                    </div>
                  </button>
                ))}
              </div>

              {/* Timeline for selected month */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar size={14} className="text-faint" />
                  <h2 className="text-[14px] font-heading font-semibold text-strong capitalize">
                    {monthLabel(activeMonth ?? '')}
                  </h2>
                  <span className="text-[11px] font-mono-custom text-faint ml-1">
                    {activeGroup.length} licitações
                  </span>
                </div>

                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[5px] top-4 bottom-4 w-px bg-subtle" />

                  <div className="space-y-3">
                    {activeGroup
                      .sort((a, b) => {
                        const da = diasRestantes(a.licitacaoRelacionada?.dataEncerramentoProposta) ?? 999
                        const db = diasRestantes(b.licitacaoRelacionada?.dataEncerramentoProposta) ?? 999
                        return da - db
                      })
                      .map((opp) => (
                        <TimelineCard key={opp.id} opp={opp} />
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
