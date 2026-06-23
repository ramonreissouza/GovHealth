'use client'
// src/app/estados/page.tsx — Portais Estaduais (SP, RJ, MG, BA)

import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  ExternalLink, Search, CheckCircle2, AlertCircle, RefreshCw,
  Building2, MapPin, ChevronDown, ChevronUp, Wifi, WifiOff,
} from 'lucide-react'
import type { ResultadoEstado, KPIsEstado, UFEstadual, LicitacaoEstadual } from '@/lib/portais-estaduais'
import { PORTAIS_CONFIG, ENTIDADES_SAUDE, TODAS_UFS } from '@/lib/portais-estaduais'
import { CATEGORIA_COLOR as CAT_COLOR } from '@/lib/categorias'
import { formatBRL } from '@/lib/format'

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
  if (l.dataEncerramento) return new Date(l.dataEncerramento) > new Date()
  const s = (l.situacao ?? '').toLowerCase()
  return s.includes('aberto') || s.includes('publicad') || s.includes('divulgad') || s.includes('recebendo')
}

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

// ── Detalhe do estado ─────────────────────────────────────────────────────────

function EstadoDetalhe({ uf, statusFiltro, onStatusChange }: { uf: UFEstadual; statusFiltro: StatusFiltro; onStatusChange: (v: StatusFiltro) => void }) {
  const [resultado, setResultado]   = useState<ResultadoEstado | null>(null)
  const [loading, setLoading]       = useState(true)
  const [query, setQuery]           = useState('')
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [showEntidades, setShowEntidades] = useState(false)

  const toggle = (id: string) =>
    setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })

  useEffect(() => {
    setLoading(true)
    setResultado(null)
    fetch(`/api/portais-estaduais?uf=${uf}`)
      .then((r) => r.json())
      .then((d) => setResultado(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [uf])

  const portal  = PORTAIS_CONFIG[uf]
  const color   = accent(uf)
  const entidades = ENTIDADES_SAUDE[uf] ?? []

  const licitacoes: LicitacaoEstadual[] = resultado?.licitacoes ?? []
  const filtered = licitacoes.filter((l) => {
    if (statusFiltro === 'abertas' && !isAbertaLic(l)) return false
    if (statusFiltro === 'fechadas' && isAbertaLic(l)) return false
    return (
      !query ||
      l.proponente.toLowerCase().includes(query.toLowerCase()) ||
      l.descricao.toLowerCase().includes(query.toLowerCase()) ||
      l.municipio.toLowerCase().includes(query.toLowerCase())
    )
  })
  const nAbertas = licitacoes.filter(isAbertaLic).length

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
            placeholder="Buscar por proponente, item, município…"
            className="flex-1 bg-transparent text-[12px] text-strong placeholder:text-faint outline-none"
          />
          <StatusFilter value={statusFiltro} onChange={onStatusChange} />
          <span className="text-[10px] font-mono-custom text-faint whitespace-nowrap">
            {filtered.length} de {licitacoes.length} · {nAbertas} abertas
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
                <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Data</th>
                <th className="text-right text-[9px] font-mono-custom text-faint uppercase tracking-wider px-4 py-2.5">Valor</th>
                <th className="text-center text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Fonte</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, idx) => {
                const isOpen = expanded.has(l.id)
                const estaAberto = l.dataEncerramento
                  ? new Date(l.dataEncerramento) > new Date()
                  : l.situacao.toLowerCase().includes('aberto')
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

                      {/* Data */}
                      <td className="px-3 py-2.5 text-center">
                        <div className="text-[10px] font-mono-custom text-muted">{formatDate(l.dataPublicacao)}</div>
                        {l.dataEncerramento && (
                          <div className={clsx('text-[9px] font-mono-custom', estaAberto ? 'text-emerald-400' : 'text-faint')}>
                            até {formatDate(l.dataEncerramento)}
                          </div>
                        )}
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
                        <td colSpan={6} className="px-6 py-4">
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
                              {l.dataEncerramento && (
                                <div className="flex gap-2">
                                  <span className="text-faint w-20 flex-shrink-0">Encerramento</span>
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

function TabelaComparacao({ resumo, statusFiltro }: { resumo: ResumoPayload | null; statusFiltro: StatusFiltro }) {
  if (!resumo) return null
  const fechadasDe = (uf: UFEstadual) => Math.max((resumo.estados[uf]?.kpis.total ?? 0) - (resumo.estados[uf]?.kpis.abertas ?? 0), 0)
  const metrica = (uf: UFEstadual) =>
    statusFiltro === 'abertas' ? (resumo.estados[uf]?.kpis.abertas ?? 0)
    : statusFiltro === 'fechadas' ? fechadasDe(uf)
    : (resumo.estados[uf]?.kpis.total ?? 0)
  // Ordena pelo métrica do filtro (mais ativos primeiro)
  const ufs: UFEstadual[] = [...TODAS_UFS].sort((a, b) => metrica(b) - metrica(a))

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

  const metricaUF = useCallback((uf: UFEstadual) => {
    const k = resumo?.estados[uf]?.kpis
    if (!k) return 0
    if (statusFiltro === 'abertas') return k.abertas
    if (statusFiltro === 'fechadas') return Math.max(k.total - k.abertas, 0)
    return k.total
  }, [resumo, statusFiltro])

  useEffect(() => {
    fetch('/api/portais-estaduais?all=1')
      .then((r) => r.json())
      .then((d) => setResumo(d))
      .catch(() => {})
      .finally(() => setResumoLoading(false))
  }, [])

  const totalLicitacoes = resumo
    ? UFS.reduce((s, uf) => s + (resumo.estados[uf]?.kpis.total ?? 0), 0)
    : 0

  const totalValor = resumo
    ? UFS.reduce((s, uf) => s + (resumo.estados[uf]?.kpis.valorTotal ?? 0), 0)
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
                  kpis={resumo?.estados[selectedUF]?.kpis ?? {
                    total: 0, abertas: 0, valorTotal: 0, ticketMedio: 0,
                    entidadesEstaduais: 0, porCategoria: {}, topProponentes: [],
                  }}
                  fontesAtivas={resumo?.estados[selectedUF]?.fontesAtivas ?? { pncp: false, portalProprio: false }}
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

              {/* ── Cards de estado (ordenados pela métrica do filtro) ──────── */}
              <div className="grid grid-cols-4 gap-3">
                {[...UFS].sort((a, b) => metricaUF(b) - metricaUF(a)).map((uf) => (
                  <EstadoCard
                    key={uf}
                    uf={uf}
                    kpis={resumo?.estados[uf]?.kpis ?? {
                      total: 0, abertas: 0, valorTotal: 0, ticketMedio: 0,
                      entidadesEstaduais: 0, porCategoria: {}, topProponentes: [],
                    }}
                    fontesAtivas={resumo?.estados[uf]?.fontesAtivas ?? { pncp: false, portalProprio: false }}
                    selected={false}
                    loading={resumoLoading}
                    statusFiltro={statusFiltro}
                    onClick={() => setSelectedUF(uf)}
                  />
                ))}
              </div>

              {/* ── Comparação ────────────────────────────────────────────── */}
              {!resumoLoading && <TabelaComparacao resumo={resumo} statusFiltro={statusFiltro} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
