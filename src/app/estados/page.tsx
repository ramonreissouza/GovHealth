'use client'
// src/app/estados/page.tsx — Portais Estaduais (SP, RJ, MG, BA)

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  ExternalLink, Search, CheckCircle2, AlertCircle, RefreshCw,
  Building2, MapPin, ChevronDown, ChevronUp, Wifi, WifiOff, Package,
  FileSearch, ChevronRight,
} from 'lucide-react'
import type { ResultadoEstado, KPIsEstado, UFEstadual, LicitacaoEstadual } from '@/lib/portais-estaduais'
import type { ItemPNCP } from '@/lib/pncp'
import { PORTAIS_CONFIG, ENTIDADES_SAUDE, TODAS_UFS } from '@/lib/portais-estaduais'
import { CATEGORIA_COLOR as CAT_COLOR } from '@/lib/categorias'
import { formatBRL } from '@/lib/format'
import { matchesTermo } from '@/lib/text'
import { publishDataStatus } from '@/lib/data-status'

// ── Types from API response ───────────────────────────────────────────────────

interface ResumoPayload {
  estados: Partial<Record<UFEstadual, {
    kpis: KPIsEstado
    fontesAtivas: { pncp: boolean; portalProprio: boolean }
  }>>
  portais: typeof PORTAIS_CONFIG
  atualizadoEm: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(s: string) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
  catch { return s }
}

// Status de uma licitação (mesma lógica dos KPIs): aberta se ainda dentro do prazo
// de encerramento, ou — sem data — se a situação indicar processo em andamento.
function isAbertaLic(l: LicitacaoEstadual): boolean {
  // Status canônico (resultado homologado) prevalece — a data-limite é só informativa.
  if (typeof l.aberto === 'boolean') return l.aberto
  if (l.dataEncerramento) return new Date(l.dataEncerramento) > new Date()
  const s = (l.situacao ?? '').toLowerCase()
  return s.includes('aberto') || s.includes('publicad') || s.includes('divulgad') || s.includes('recebendo')
}

// Estado da pré-análise de itens de uma licitação.
// liveTried = já tentamos o fallback ao vivo no PNCP (evita refetch a cada abrir).
interface ItensState { itens: ItemPNCP[]; loading: boolean; erro?: boolean; liveTried?: boolean }

type StatusFiltro = 'todas' | 'abertas' | 'fechadas'

// Toggle reutilizável Todas / Abertas / Fechadas.
function StatusFilter({ value, onChange }: { value: StatusFiltro; onChange: (v: StatusFiltro) => void }) {
  const opts: [StatusFiltro, string][] = [['todas', 'Todas'], ['abertas', 'Abertas'], ['fechadas', 'Fechadas']]
  return (
    <div className="flex gap-1 items-center">
      {opts.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
            value === k ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
          {label}
        </button>
      ))}
    </div>
  )
}

const STATE_ACCENT: Partial<Record<UFEstadual, string>> = {
  SP: 'text-brand-blue',
  MG: 'text-brand-purple',
  RJ: 'text-emerald-600',
  BA: 'text-amber',
}
const accent = (uf: UFEstadual) => STATE_ACCENT[uf] ?? 'text-brand-blue'

// Monograma profissional da UF — substitui os emojis decorativos.
function UFBadge({ uf, color, size = 'sm' }: { uf: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'w-11 h-11 text-[14px]' : size === 'md' ? 'w-9 h-9 text-[12px]' : 'w-7 h-7 text-[10px]'
  return (
    <span className={clsx('inline-flex items-center justify-center rounded-lg bg-bg4 border border-subtle2 font-mono-custom font-bold flex-shrink-0', dim, color)}>
      {uf}
    </span>
  )
}

// ── Estado Card (overview) ────────────────────────────────────────────────────

function EstadoCard({
  uf,
  kpis,
  fontesAtivas,
  selected,
  loading,
  statusFiltro = 'todas',
  onClick,
}: {
  uf: UFEstadual
  kpis: KPIsEstado
  fontesAtivas: { pncp: boolean; portalProprio: boolean }
  selected: boolean
  loading: boolean
  statusFiltro?: StatusFiltro
  onClick: () => void
}) {
  const portal = PORTAIS_CONFIG[uf]
  const color  = accent(uf)
  const fechadas = Math.max(kpis.total - kpis.abertas, 0)
  const primaria =
    statusFiltro === 'abertas' ? { label: 'Em aberto', value: kpis.abertas }
    : statusFiltro === 'fechadas' ? { label: 'Encerradas', value: fechadas }
    : { label: 'Licitações', value: kpis.total }

  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-left rounded-xl border p-4 transition-all w-full',
        selected
          ? 'bg-bg3 border-accent/60 ring-1 ring-accent/20'
          : 'bg-bg2 border-subtle hover:border-subtle2 hover:bg-bg3'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <UFBadge uf={uf} color={color} size="md" />
          <div>
            <div className={clsx('text-[14px] font-bold leading-tight', color)}>{portal.nomeEstado}</div>
            <div className="text-[10px] text-faint font-mono-custom">{uf}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {fontesAtivas.pncp
            ? <span title="PNCP conectado"><Wifi size={12} className="text-emerald-400" /></span>
            : <span title="PNCP offline"><WifiOff size={12} className="text-faint" /></span>
          }
          {portal.temAPIPublica && (
            fontesAtivas.portalProprio
              ? <span title={`${portal.nomePortal} conectado`}><CheckCircle2 size={12} className="text-emerald-400" /></span>
              : <span title={`${portal.nomePortal} tentando`}><AlertCircle size={12} className="text-faint" /></span>
          )}
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="flex items-center gap-1.5 text-[11px] text-faint">
          <RefreshCw size={11} className="animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[10px] text-faint">{primaria.label}</span>
            <span className={clsx('text-[13px] font-mono-custom font-bold',
              statusFiltro === 'abertas' ? 'text-emerald-400' : 'text-strong')}>{primaria.value}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-faint">Valor total</span>
            <span className="text-[12px] font-mono-custom text-accent">{formatBRL(kpis.valorTotal)}</span>
          </div>
          {statusFiltro === 'todas' && (
            <div className="flex justify-between">
              <span className="text-[10px] text-faint">Em aberto</span>
              <span className={clsx('text-[11px] font-mono-custom', kpis.abertas > 0 ? 'text-emerald-400' : 'text-faint')}>
                {kpis.abertas}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[10px] text-faint">Entidades estaduais</span>
            <span className="text-[11px] font-mono-custom text-brand-blue">{kpis.entidadesEstaduais}</span>
          </div>
        </div>
      )}

      {/* Portal */}
      <div className="mt-3 pt-2.5 border-t border-subtle/50 text-[9px] font-mono-custom text-faint">
        {portal.nomePortal} · {portal.notaIntegracao}
      </div>
    </button>
  )
}

// ── Pré-análise de itens (o que está sendo orçado) ────────────────────────────
// Lista os itens (equipamentos/acessórios) da licitação buscados no PNCP, sem
// precisar sair da plataforma. Destaca os itens que casam com a busca ativa.
function ItensPreAnalise({ estado, query }: { estado?: ItensState; query: string }) {
  if (!estado) return null
  if (estado.loading) {
    return (
      <div className="mt-4 pt-4 border-t border-subtle/60 flex items-center gap-2 text-[11px] text-faint">
        <Package size={12} className="animate-pulse" />
        Pré-analisando itens no PNCP…
      </div>
    )
  }
  if (estado.erro || estado.itens.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-subtle/60 text-[11px] text-faint">
        Itens detalhados não disponíveis para esta licitação no PNCP.
      </div>
    )
  }
  const temQuery = query.trim().length > 0
  const total = estado.itens.reduce((s, it) => s + (it.quantidade || 0) * (it.valorUnitarioEstimado || 0), 0)
  return (
    <div className="mt-4 pt-4 border-t border-subtle/60">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider flex items-center gap-1.5">
          <Package size={11} />
          Pré-análise — o que está sendo orçado ({estado.itens.length} iten{estado.itens.length !== 1 ? 's' : ''})
        </div>
        {total > 0 && (
          <div className="text-[10px] font-mono-custom text-faint">
            Soma dos itens <span className="text-accent font-bold">{formatBRL(total)}</span>
          </div>
        )}
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
        {estado.itens.map((item) => {
          const match = temQuery && matchesTermo(query, item.descricao)
          return (
            <div
              key={item.numeroItem}
              className={clsx('flex items-start gap-3 px-3 py-2 rounded-lg', match ? 'bg-accent/10 border border-accent/30' : 'bg-bg4/40')}
            >
              <span className="text-[9px] font-mono-custom text-faint w-5 flex-shrink-0 mt-0.5">{item.numeroItem}</span>
              <span className="text-[11px] text-strong flex-1 leading-snug">{item.descricao}</span>
              <span className="text-[10px] font-mono-custom text-faint flex-shrink-0 whitespace-nowrap">
                {item.quantidade} {item.unidadeMedida}
              </span>
              <span className="text-[11px] font-mono-custom font-bold text-accent flex-shrink-0 whitespace-nowrap">
                {formatBRL((item.quantidade || 0) * (item.valorUnitarioEstimado || 0))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Detalhe do estado ─────────────────────────────────────────────────────────

function EstadoDetalhe({ uf, statusFiltro, onStatusChange }: { uf: UFEstadual; statusFiltro: StatusFiltro; onStatusChange: (v: StatusFiltro) => void }) {
  const [resultado, setResultado]   = useState<ResultadoEstado | null>(null)
  const [loading, setLoading]       = useState(true)
  const [query, setQuery]           = useState('')
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [showEntidades, setShowEntidades] = useState(false)
  // Pré-análise: itens (equipamentos/acessórios) de cada licitação, buscados no
  // PNCP em segundo plano. Alimenta tanto o detalhe expandido quanto a busca.
  const [itensMap, setItensMap] = useState<Record<string, ItensState>>({})

  const toggle = (id: string) => {
    let abriu = false
    setExpanded((p) => {
      const s = new Set(p)
      if (s.has(id)) s.delete(id)
      else { s.add(id); abriu = true }
      return s
    })
    if (abriu) carregarItensLive(id)
  }

  // Fallback ao vivo: ao expandir uma licitação sem itens no banco (ex.: Portais
  // Estaduais / DF), busca os itens direto no PNCP — para o detalhe não "morrer".
  const carregarItensLive = (id: string) => {
    const cur = itensMap[id]
    // já tem itens, está carregando, ou já tentamos ao vivo → nada a fazer
    if (cur && (cur.itens.length > 0 || cur.loading || cur.liveTried)) return
    setItensMap((prev) => ({ ...prev, [id]: { itens: prev[id]?.itens ?? [], loading: true, liveTried: true } }))
    fetch(`/api/itens-pncp?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((j: { itens?: ItemPNCP[] }) => {
        setItensMap((prev) => ({ ...prev, [id]: { itens: j.itens ?? [], loading: false, liveTried: true } }))
      })
      .catch(() => {
        setItensMap((prev) => ({ ...prev, [id]: { itens: prev[id]?.itens ?? [], loading: false, liveTried: true, erro: true } }))
      })
  }

  useEffect(() => {
    setLoading(true)
    setResultado(null)
    setItensMap({})
    // Status vai ao servidor (abertas/fechadas) — encerradas são muitas, então a
    // lista é limitada no banco; os KPIs continuam sendo do estado inteiro.
    const sp = statusFiltro === 'abertas' || statusFiltro === 'fechadas' ? `&status=${statusFiltro}` : ''
    fetch(`/api/portais-estaduais?uf=${uf}${sp}`)
      .then((r) => r.json())
      .then((d) => setResultado(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [uf, statusFiltro])

  // Pré-carrega os itens de TODAS as licitações do estado numa ÚNICA chamada em
  // lote (banco) para permitir buscar por equipamento — ex.: "luvas cirúrgicas" —
  // filtrando as licitações pelo conteúdo orçado, sem precisar abrir o PNCP.
  useEffect(() => {
    const lics = resultado?.licitacoes ?? []
    if (lics.length === 0) { setItensMap({}); return }
    let cancelled = false
    const ids = lics.map((l) => l.id)
    setItensMap(Object.fromEntries(ids.map((id) => [id, { itens: [], loading: true }])))
    fetch('/api/itens-lote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then((r) => r.json())
      .then((j: { itens?: Record<string, ItemPNCP[]> }) => {
        if (cancelled) return
        setItensMap(Object.fromEntries(ids.map((id) => [id, { itens: j.itens?.[id] ?? [], loading: false }])))
      })
      .catch(() => {
        if (cancelled) return
        setItensMap(Object.fromEntries(ids.map((id) => [id, { itens: [], loading: false, erro: true }])))
      })
    return () => { cancelled = true }
  }, [resultado])

  // Rede de segurança: se um card já está aberto e o banco não trouxe itens (e
  // ainda não tentamos ao vivo), dispara o fallback no PNCP. Cobre o caso de o
  // usuário abrir antes do lote do banco terminar. carregarItensLive é idempotente.
  useEffect(() => {
    for (const id of expanded) {
      const st = itensMap[id]
      if (st && !st.loading && !st.liveTried && st.itens.length === 0) carregarItensLive(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, itensMap])

  const portal  = PORTAIS_CONFIG[uf]
  const color   = accent(uf)
  const entidades = ENTIDADES_SAUDE[uf] ?? []

  const licitacoes: LicitacaoEstadual[] = resultado?.licitacoes ?? []
  const temQuery = query.trim().length > 0
  const filtered = licitacoes.filter((l) => {
    if (statusFiltro === 'abertas' && !isAbertaLic(l)) return false
    if (statusFiltro === 'fechadas' && isAbertaLic(l)) return false
    if (!temQuery) return true
    // Casa contra proponente/objeto/município E contra os itens (equipamentos/
    // acessórios) já pré-analisados — tolerante a acento e plural.
    const itensTexto = (itensMap[l.id]?.itens ?? []).map((it) => it.descricao).join(' ')
    return matchesTermo(query, l.proponente, l.descricao, l.municipio, itensTexto)
  })
  const nAbertas = licitacoes.filter(isAbertaLic).length

  // Progresso da pré-análise de itens (para indicar que a busca ainda está indexando).
  const totalComItens = Object.keys(itensMap).length
  const itensCarregados = Object.values(itensMap).filter((s) => !s.loading).length
  const analisandoItens = totalComItens > 0 && itensCarregados < totalComItens

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-bg2 border border-subtle rounded-xl p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <UFBadge uf={uf} color={color} size="lg" />
            <div>
              <div className={clsx('text-[20px] font-bold', color)}>{portal.nomeEstado}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] font-mono-custom text-faint">{portal.nomePortal}</span>
                <span className="text-faint">·</span>
                <a href={portal.urlPortal} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono-custom text-faint hover:text-accent transition-colors">
                  <ExternalLink size={10} />
                  {portal.urlPortal.replace('https://', '')}
                </a>
              </div>
            </div>
          </div>

          {/* Fontes ativas */}
          <div className="flex flex-col gap-1 items-end">
            <div className={clsx('flex items-center gap-1.5 text-[10px] font-mono-custom',
              resultado?.fontesAtivas.pncp ? 'text-emerald-400' : 'text-faint')}>
              {resultado?.fontesAtivas.pncp ? <Wifi size={11} /> : <WifiOff size={11} />}
              PNCP
            </div>
            {portal.temAPIPublica && (
              <div className={clsx('flex items-center gap-1.5 text-[10px] font-mono-custom',
                resultado?.fontesAtivas.portalProprio ? 'text-emerald-400' : 'text-amber')}>
                {resultado?.fontesAtivas.portalProprio
                  ? <><CheckCircle2 size={11} /> {portal.nomePortal}</>
                  : <><AlertCircle size={11} /> {portal.nomePortal} (sem resposta)</>
                }
              </div>
            )}
          </div>
        </div>

        {/* KPI strip */}
        {resultado && (
          <div className="grid grid-cols-5 gap-3 mt-4">
            {[
              { label: 'Licitações', value: String(resultado.kpis.total) },
              { label: 'Em aberto', value: String(resultado.kpis.abertas), color: 'text-emerald-400' },
              { label: 'Valor total', value: formatBRL(resultado.kpis.valorTotal) },
              { label: 'Ticket médio', value: formatBRL(resultado.kpis.ticketMedio) },
              { label: 'Entidades estaduais', value: String(resultado.kpis.entidadesEstaduais), color: 'text-brand-blue' },
            ].map(({ label, value, color: c }) => (
              <div key={label} className="bg-bg3 rounded-lg px-3 py-2">
                <div className="text-[9px] font-mono-custom text-faint uppercase tracking-wider">{label}</div>
                <div className={clsx('text-[16px] font-mono-custom font-bold mt-0.5', c ?? 'text-strong')}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Entidades-chave (somente UFs com lista curada) */}
      {entidades.length > 0 && (
      <div className="bg-bg2 border border-subtle rounded-xl px-4 py-3">
        <button
          onClick={() => setShowEntidades((p) => !p)}
          className="flex items-center gap-2 w-full text-left"
        >
          <Building2 size={13} className="text-faint" />
          <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider flex-1">
            Principais entidades de saúde monitoradas ({entidades.length})
          </span>
          {showEntidades ? <ChevronUp size={12} className="text-faint" /> : <ChevronDown size={12} className="text-faint" />}
        </button>
        {showEntidades && (
          <div className="flex gap-1.5 flex-wrap mt-3">
            {entidades.map((e) => (
              <span key={e} className="text-[10px] font-mono-custom px-2 py-0.5 rounded-full bg-bg4 text-muted border border-subtle2">
                {e}
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Licitações */}
      <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
        {/* Search */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-subtle">
          <Search size={13} className="text-faint flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por equipamento, item, proponente, município… (ex: luvas cirúrgicas)"
            className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none"
          />
          <StatusFilter value={statusFiltro} onChange={onStatusChange} />
          <span className="text-[10px] font-mono-custom text-faint whitespace-nowrap">
            {filtered.length} de {licitacoes.length} · {nAbertas} abertas
            {analisandoItens && (
              <span className="text-accent"> · analisando itens {itensCarregados}/{totalComItens}</span>
            )}
          </span>
          <a
            href={portal.urlConsulta}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono-custom text-faint hover:text-accent transition-colors ml-2"
          >
            <ExternalLink size={10} />
            Abrir {portal.nomePortal}
          </a>
        </div>

        {loading ? (
          <div className="p-10 text-center text-faint text-[13px]">
            Buscando licitações de saúde em {portal.nomeEstado}…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-faint text-[13px]">
            {licitacoes.length === 0
              ? 'Nenhuma licitação de saúde encontrada. A API do PNCP pode estar indisponível.'
              : 'Nenhum resultado para o filtro aplicado.'}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-subtle bg-bg3/40">
                <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Proponente</th>
                <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Item / Categoria</th>
                <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Status</th>
                <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-2 py-2.5">Publicação</th>
                <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-2 py-2.5">Abertura</th>
                <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-2 py-2.5">Fechamento</th>
                <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor</th>
                <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, idx) => {
                const isOpen = expanded.has(l.id)
                const itSt = itensMap[l.id]
                const estaAberto = isAbertaLic(l)
                const isEstadual = (ENTIDADES_SAUDE[uf] ?? []).some(
                  (e) => l.proponente.toLowerCase().includes(e.toLowerCase())
                )

                return (
                  <React.Fragment key={`${l.id}-${idx}`}>
                    <tr
                      className={clsx(
                        'border-b border-subtle transition-colors cursor-pointer',
                        isOpen ? 'bg-bg3' : 'hover:bg-bg3'
                      )}
                      onClick={() => toggle(l.id)}
                    >
                      {/* Proponente */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {isEstadual && (
                            <span title="Entidade estadual de saúde">
                              <Building2 size={11} className="text-brand-blue flex-shrink-0" />
                            </span>
                          )}
                          <div>
                            <div className="text-[12px] text-strong max-w-[180px] truncate">{l.proponente}</div>
                            <div className="text-[9px] font-mono-custom text-faint flex items-center gap-1">
                              <MapPin size={8} />
                              {l.municipio} / {l.uf}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Item */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase flex-shrink-0', CAT_COLOR[l.categoria] ?? CAT_COLOR.outros)}>
                            {l.categoria}
                          </span>
                          <span className="text-[11px] text-muted max-w-[160px] truncate">{l.descricao}</span>
                          {itSt?.loading ? (
                            <span title="Pré-analisando itens no PNCP">
                              <Package size={10} className="text-faint animate-pulse flex-shrink-0" />
                            </span>
                          ) : itSt && itSt.itens.length > 0 ? (
                            <span
                              title={`${itSt.itens.length} itens orçados — clique para ver a pré-análise`}
                              className="inline-flex items-center gap-1 text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 flex-shrink-0"
                            >
                              <Package size={9} />
                              {itSt.itens.length}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5">
                        <span className={clsx(
                          'text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                          estaAberto
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-bg4 text-faint border border-subtle2'
                        )}>
                          {estaAberto ? 'Aberto' : (l.situacao || 'Encerrado')}
                        </span>
                      </td>

                      {/* Publicação */}
                      <td className="px-2 py-2.5 text-center">
                        <span className="text-[10px] font-mono-custom text-muted">{formatDate(l.dataPublicacao)}</span>
                      </td>

                      {/* Abertura (início do recebimento de propostas) */}
                      <td className="px-2 py-2.5 text-center">
                        <span className="text-[10px] font-mono-custom text-muted">{formatDate(l.dataAbertura ?? '')}</span>
                      </td>

                      {/* Fechamento (prazo final de propostas) */}
                      <td className="px-2 py-2.5 text-center">
                        <span className={clsx('text-[10px] font-mono-custom',
                          l.dataEncerramento ? (estaAberto ? 'text-emerald-400' : 'text-faint') : 'text-faint')}>
                          {formatDate(l.dataEncerramento ?? '')}
                        </span>
                      </td>

                      {/* Valor */}
                      <td className="px-4 py-2.5 text-right">
                        <div className="text-[13px] font-mono-custom font-bold text-strong">{formatBRL(l.valor)}</div>
                      </td>

                      {/* Fonte */}
                      <td className="px-3 py-2.5 text-center">
                        <span className={clsx(
                          'text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase',
                          l.fonte === 'pncp'
                            ? 'bg-bg4 text-faint border border-subtle2'
                            : 'bg-accent/15 text-accent border border-accent/30'
                        )}>
                          {l.fonte === 'pncp' ? 'PNCP' : l.fonte.toUpperCase()}
                        </span>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-b border-subtle bg-bg3/40">
                        <td colSpan={8} className="px-6 py-4">
                          {/* Deep-link para a tela Licitações, já filtrada nesta demanda
                              (score, itens, concorrentes, análise completa). */}
                          <Link
                            href={`/oportunidades?opp=${encodeURIComponent(l.id)}&uf=${l.uf}`}
                            onClick={(e) => e.stopPropagation()}
                            className="group flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-3 mb-4 hover:bg-accent/10 transition-colors"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <FileSearch size={15} className="text-accent flex-shrink-0" />
                              <span className="min-w-0">
                                <span className="block text-[12px] font-semibold text-accent leading-tight">Ver licitação completa em Licitações</span>
                                <span className="block text-[10px] text-faint">abre filtrado nesta demanda — score, itens, vencedores/concorrentes e mais</span>
                              </span>
                            </span>
                            <ChevronRight size={15} className="text-accent flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
                          </Link>
                          <div className="grid grid-cols-2 gap-6 text-[12px]">
                            <div className="space-y-2">
                              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Objeto completo</div>
                              <p className="text-strong leading-relaxed">{l.descricao}</p>
                              <div className="text-[10px] font-mono-custom text-faint">
                                Modalidade: {l.modalidade || '—'}
                              </div>
                              {l.cnpj && (
                                <div className="text-[10px] font-mono-custom text-faint">
                                  CNPJ: {l.cnpj}
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Referências</div>
                              <div className="flex gap-2">
                                <span className="text-faint w-20 flex-shrink-0">Nº externo</span>
                                <span className="font-mono-custom text-muted text-[11px]">{l.numeroExterno || '—'}</span>
                              </div>
                              <div className="flex gap-2">
                                <span className="text-faint w-20 flex-shrink-0">Publicação</span>
                                <span className="text-strong">{formatDate(l.dataPublicacao)}</span>
                              </div>
                              {l.dataAbertura && (
                                <div className="flex gap-2">
                                  <span className="text-faint w-20 flex-shrink-0">Abertura</span>
                                  <span className="text-strong">{formatDate(l.dataAbertura)}</span>
                                </div>
                              )}
                              {l.dataEncerramento && (
                                <div className="flex gap-2">
                                  <span className="text-faint w-20 flex-shrink-0">Fechamento</span>
                                  <span className={estaAberto ? 'text-emerald-400' : 'text-strong'}>
                                    {formatDate(l.dataEncerramento)}
                                  </span>
                                </div>
                              )}
                              <a
                                href={l.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] text-faint hover:text-accent transition-colors mt-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink size={11} />
                                Ver no {l.fonte === 'pncp' ? 'PNCP' : portal.nomePortal}
                              </a>
                            </div>
                          </div>

                          {/* Pré-análise dos itens orçados (equipamentos/acessórios) */}
                          <ItensPreAnalise estado={itSt} query={query} />
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
  )
}

// ── Comparação entre estados ──────────────────────────────────────────────────

function TabelaComparacao({ resumo }: { resumo: ResumoPayload | null }) {
  if (!resumo) return null
  const fechadasDe = (uf: UFEstadual) => Math.max((resumo.estados[uf]?.kpis.total ?? 0) - (resumo.estados[uf]?.kpis.abertas ?? 0), 0)
  // Ordem alfabética (por nome do estado)
  const ufs: UFEstadual[] = [...TODAS_UFS].sort((a, b) =>
    PORTAIS_CONFIG[a].nomeEstado.localeCompare(PORTAIS_CONFIG[b].nomeEstado, 'pt-BR'))

  return (
    <div className="bg-bg2 border border-subtle rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle">
        <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">Comparativo das 27 UFs</div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-subtle bg-bg3/40">
            <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2">Estado</th>
            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Licitações</th>
            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Em aberto</th>
            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Encerradas</th>
            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2">Valor total</th>
            <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Ticket médio</th>
            <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">PNCP</th>
            <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2">Portal Próprio</th>
          </tr>
        </thead>
        <tbody>
          {ufs.map((uf) => {
            const d = resumo.estados[uf]
            const portal = PORTAIS_CONFIG[uf]
            const color = accent(uf)
            if (!d) return null
            return (
              <tr key={uf} className="border-b border-subtle last:border-0 hover:bg-bg3 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <UFBadge uf={uf} color={color} size="sm" />
                    <div>
                      <span className={clsx('text-[13px] font-bold', color)}>{uf}</span>
                      <span className="text-[10px] text-faint ml-1.5">{portal.nomeEstado}</span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono-custom text-[13px] text-strong">{d.kpis.total}</td>
                <td className="px-3 py-2.5 text-right font-mono-custom text-[12px] text-emerald-400">{d.kpis.abertas}</td>
                <td className="px-3 py-2.5 text-right font-mono-custom text-[12px] text-muted">{fechadasDe(uf)}</td>
                <td className="px-4 py-2.5 text-right font-mono-custom text-[13px] text-accent font-bold">{formatBRL(d.kpis.valorTotal)}</td>
                <td className="px-3 py-2.5 text-right font-mono-custom text-[11px] text-muted">{formatBRL(d.kpis.ticketMedio)}</td>
                <td className="px-3 py-2.5 text-center">
                  {d.fontesAtivas.pncp
                    ? <Wifi size={12} className="text-emerald-400 inline" />
                    : <WifiOff size={12} className="text-faint inline" />
                  }
                </td>
                <td className="px-3 py-2.5 text-center">
                  {portal.temAPIPublica
                    ? d.fontesAtivas.portalProprio
                      ? <CheckCircle2 size={12} className="text-emerald-400 inline" />
                      : <AlertCircle size={12} className="text-amber inline" />
                    : <span className="text-[9px] font-mono-custom text-faint">Sem API</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const UFS: UFEstadual[] = TODAS_UFS

export default function EstadosPage() {
  const [resumo, setResumo]           = useState<ResumoPayload | null>(null)
  const [resumoLoading, setResumoLoading] = useState(true)
  const [selectedUF, setSelectedUF]   = useState<UFEstadual | null>(null)
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('todas')
  useEffect(() => {
    fetch('/api/portais-estaduais?all=1')
      .then((r) => r.json())
      .then((d) => { publishDataStatus(d); setResumo(d) })
      .catch(() => {})
      .finally(() => setResumoLoading(false))
  }, [])

  // Havia aqui um 2º passo "progressivo" que, depois do resumo, refazia a contagem de
  // cada UF chamando /api/portais-estaduais?uf=XX — 27 requisições, 2 por vez, com
  // 400 ms de pausa entre elas. A tela levava 71 s para ficar pronta, com os 27 cards
  // escritos "Carregando…" durante mais de um minuto.
  //
  // O passo era herança de quando o resumo era uma AMOSTRA do PNCP ao vivo. Hoje
  // `buscarResumoEstadosDB` já devolve a contagem real das 27 UFs numa consulta só, e
  // o KPI por UF do detalhe é literalmente a MESMA agregação com `WHERE uf = $1` no
  // lugar do `GROUP BY uf`. Ou seja: 27 requisições para recalcular, uma a uma, número
  // idêntico ao que a primeira já trouxe. Removido.
  const resumoEfetivo = resumo

  const totalLicitacoes = resumoEfetivo
    ? UFS.reduce((s, uf) => s + (resumoEfetivo.estados[uf]?.kpis.total ?? 0), 0)
    : 0

  const totalValor = resumoEfetivo
    ? UFS.reduce((s, uf) => s + (resumoEfetivo.estados[uf]?.kpis.valorTotal ?? 0), 0)
    : 0

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title="Portais Estaduais"
          subtitle={
            resumoLoading
              ? 'Carregando…'
              : `${totalLicitacoes} licitações · ${formatBRL(totalValor)} · 27 UFs (via PNCP)`
          }
        />

        <main className="flex-1 overflow-y-auto p-6 bg-bg space-y-4">

          {selectedUF ? (
            <>
              {/* ── Estado selecionado: demais colapsados ──────────────────── */}
              <button
                onClick={() => setSelectedUF(null)}
                className="inline-flex items-center gap-1.5 text-[12px] font-mono-custom text-faint hover:text-accent transition-colors"
              >
                ← Ver todos os 27 estados
              </button>

              {/* Card único do estado selecionado */}
              <div className="max-w-xs">
                <EstadoCard
                  uf={selectedUF}
                  kpis={resumoEfetivo?.estados[selectedUF]?.kpis ?? {
                    total: 0, abertas: 0, valorTotal: 0, ticketMedio: 0,
                    entidadesEstaduais: 0, porCategoria: {}, topProponentes: [],
                  }}
                  fontesAtivas={resumoEfetivo?.estados[selectedUF]?.fontesAtivas ?? { pncp: false, portalProprio: false }}
                  selected
                  loading={resumoLoading}
                  statusFiltro={statusFiltro}
                  onClick={() => setSelectedUF(null)}
                />
              </div>

              {/* Tabela de licitações do estado (sobe para o topo) */}
              <EstadoDetalhe uf={selectedUF} statusFiltro={statusFiltro} onStatusChange={setStatusFiltro} />
            </>
          ) : (
            <>
              {/* ── Filtro de status ────────────────────────────────────────── */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono-custom text-faint uppercase tracking-wider">Filtrar por status</span>
                <StatusFilter value={statusFiltro} onChange={setStatusFiltro} />
              </div>

              {/* ── Cards de estado (ordem alfabética) ──────────────────────── */}
              <div className="grid grid-cols-4 gap-3">
                {[...UFS].sort((a, b) => PORTAIS_CONFIG[a].nomeEstado.localeCompare(PORTAIS_CONFIG[b].nomeEstado, 'pt-BR')).map((uf) => (
                  <EstadoCard
                    key={uf}
                    uf={uf}
                    kpis={resumoEfetivo?.estados[uf]?.kpis ?? {
                      total: 0, abertas: 0, valorTotal: 0, ticketMedio: 0,
                      entidadesEstaduais: 0, porCategoria: {}, topProponentes: [],
                    }}
                    fontesAtivas={resumoEfetivo?.estados[uf]?.fontesAtivas ?? { pncp: false, portalProprio: false }}
                    selected={false}
                    loading={resumoLoading}
                    statusFiltro={statusFiltro}
                    onClick={() => setSelectedUF(uf)}
                  />
                ))}
              </div>

              {/* ── Comparação ────────────────────────────────────────────── */}
              {!resumoLoading && <TabelaComparacao resumo={resumoEfetivo} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
