'use client'
// src/components/dashboard/DashboardView.tsx
// Casca client do dashboard: mantém o estado dos filtros (UF + Tipo de fornecimento)
// e o propaga para TODOS os widgets — KPIs, oportunidades, gráfico, concorrentes e
// alertas reagem juntos ao filtro aplicado.
//
// Performance: `/api/opportunities` é buscado UMA vez aqui e o resultado
// (oportunidades + KPIs + série mensal + categorias) é passado por props para
// KPICards, OpportunityList e DashboardCharts — antes cada um fazia a mesma
// chamada (3× a mesma query pesada por filtro). Concorrentes e alertas têm
// endpoints próprios e seguem buscando sozinhos (em paralelo).

import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { MapPin, X, Loader2, Star, Trash2 } from 'lucide-react'
import KPICards from './KPICards'
import OpportunityList from './OpportunityList'
import AlertsFeed from './AlertsFeed'
import DashboardCharts from './DashboardCharts'
import ConcorrentesWidget from './ConcorrentesWidget'
import { TIPO_LABEL } from '@/lib/categorias'
import type { Oportunidade } from '@/lib/types'
import {
  getSavedViews, createSavedView, deleteSavedView, savedViewExists,
  getLastFilter, setLastFilter, type SavedView,
} from '@/lib/saved-views'

export interface OpportunitiesData {
  oportunidades: Oportunidade[]
  kpis: { total: number; quentes: number; valorTotal: number; scoreMedio: number }
  serieMensal: { mes: string; count: number; valor: number }[]
  porCategoria: { categoria: string; count: number; valor: number }[]
  fonte?: string
  avisos?: string[]
  atualizadoEm?: string
}

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

const TIPOS: { key: string; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  ...Object.entries(TIPO_LABEL).map(([key, label]) => ({ key, label })),
]

export default function DashboardView() {
  const [uf, setUf] = useState<string>('') // '' = Brasil
  const [tipo, setTipo] = useState<string>('todos')
  const [views, setViews] = useState<SavedView[]>([])

  const [oppData, setOppData] = useState<OpportunitiesData | null>(null)
  const [oppLoading, setOppLoading] = useState(true)
  const [oppError, setOppError] = useState(false)

  const filtros = { uf: uf || undefined, tipo: tipo === 'todos' ? undefined : tipo }
  const ativo = !!uf || tipo !== 'todos'

  // Ao montar: carrega filtros salvos e restaura o último filtro aplicado (perfil).
  useEffect(() => {
    setViews(getSavedViews())
    const last = getLastFilter()
    if (last) {
      if (last.uf) setUf(last.uf)
      if (last.tipo) setTipo(last.tipo)
    }
  }, [])

  // Uma única busca de oportunidades por filtro — compartilhada por KPIs, lista e gráfico.
  useEffect(() => {
    let cancelado = false
    setOppLoading(true)
    setOppError(false)
    setLastFilter(filtros) // memoriza o filtro para restaurar na próxima visita
    const params = new URLSearchParams({ limit: '300', minScore: '0' })
    if (filtros.uf) params.set('uf', filtros.uf)
    if (filtros.tipo) params.set('tipo', filtros.tipo)
    fetch(`/api/opportunities?${params}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { if (!cancelado) setOppData(d) })
      .catch(() => { if (!cancelado) setOppError(true) })
      .finally(() => { if (!cancelado) setOppLoading(false) })
    return () => { cancelado = true }
  }, [filtros.uf, filtros.tipo])

  const tipoLabelDe = (k: string) => TIPOS.find((t) => t.key === k)?.label ?? k

  function aplicar(v: SavedView) {
    setUf(v.uf ?? '')
    setTipo(v.tipo ?? 'todos')
  }

  function salvarAtual() {
    if (savedViewExists(filtros)) return
    const rotulo = `${uf || 'Brasil'} · ${tipo === 'todos' ? 'Todos' : tipoLabelDe(tipo)}`
    const nome = window.prompt('Nome do filtro salvo:', rotulo)
    if (nome === null) return // cancelou
    createSavedView(nome, filtros)
    setViews(getSavedViews())
  }

  function remover(id: string) {
    deleteSavedView(id)
    setViews(getSavedViews())
  }

  const jaSalvo = savedViewExists(filtros)

  return (
    <>
      {/* Barra de filtros — comanda todos os widgets abaixo */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <MapPin size={13} className="text-faint" />
          <select
            value={uf}
            onChange={(e) => setUf(e.target.value)}
            className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none"
          >
            <option value="">Brasil (todas UFs)</option>
            {UFS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-1 overflow-x-auto flex-1 min-w-0 pb-1">
          {TIPOS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTipo(t.key)}
              className={clsx(
                'text-[11px] font-mono-custom px-2.5 py-1 rounded-full whitespace-nowrap transition-all border',
                tipo === t.key ? 'bg-accent text-black border-accent font-bold' : 'border-subtle2 text-faint hover:text-strong',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {oppLoading && (
          <span className="flex items-center gap-1.5 text-[11px] text-accent font-mono-custom flex-shrink-0">
            <Loader2 size={12} className="animate-spin" /> Atualizando…
          </span>
        )}

        {!oppLoading && (
          <button
            onClick={salvarAtual}
            disabled={jaSalvo}
            title={jaSalvo ? 'Este filtro já está salvo' : 'Salvar este filtro'}
            className={clsx(
              'flex items-center gap-1 text-[11px] transition-colors flex-shrink-0',
              jaSalvo ? 'text-accent cursor-default' : 'text-faint hover:text-strong',
            )}
          >
            <Star size={12} className={jaSalvo ? 'fill-accent' : ''} /> {jaSalvo ? 'Salvo' : 'Salvar filtro'}
          </button>
        )}

        {ativo && !oppLoading && (
          <button
            onClick={() => { setUf(''); setTipo('todos') }}
            className="flex items-center gap-1 text-[11px] text-faint hover:text-strong transition-colors flex-shrink-0"
          >
            <X size={12} /> Limpar
          </button>
        )}
      </div>

      {/* Filtros salvos — aplicar com 1 clique */}
      {views.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[10px] font-mono-custom text-faint uppercase tracking-wider">Meus filtros</span>
          {views.map((v) => {
            const selecionado = (v.uf ?? '') === (filtros.uf ?? '') && (v.tipo ?? '') === (filtros.tipo ?? '')
            return (
              <span
                key={v.id}
                className={clsx(
                  'group inline-flex items-center gap-1.5 text-[11px] rounded-full border pl-2.5 pr-1.5 py-1 transition-colors',
                  selecionado ? 'border-accent bg-accent/10 text-accent' : 'border-subtle2 text-muted hover:text-strong',
                )}
              >
                <button onClick={() => aplicar(v)} className="whitespace-nowrap">{v.nome}</button>
                <button
                  onClick={() => remover(v.id)}
                  title="Remover filtro salvo"
                  className="text-faint hover:text-red transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* KPIs */}
      <KPICards data={oppData} loading={oppLoading} tipo={filtros.tipo} />

      {/* Oportunidades + Alertas/Concorrentes */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-bg2 border border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="font-heading font-semibold text-[13px] text-strong">
              Oportunidades prioritárias
            </span>
          </div>
          <OpportunityList data={oppData} loading={oppLoading} error={oppError} limit={6} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-bg2 border border-subtle rounded-xl p-4 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-amber" />
              <span className="font-heading font-semibold text-[13px] text-strong">
                Alertas inteligentes
              </span>
            </div>
            <AlertsFeed uf={filtros.uf} tipo={filtros.tipo} />
          </div>

          <div className="bg-bg2 border border-subtle rounded-xl p-4">
            <div className="font-heading font-semibold text-[13px] text-strong mb-3">
              Top concorrentes nacionais
            </div>
            <ConcorrentesWidget uf={filtros.uf} tipo={filtros.tipo} />
          </div>
        </div>
      </div>

      {/* Charts: tendência + categorias */}
      <DashboardCharts data={oppData} loading={oppLoading} />
    </>
  )
}
