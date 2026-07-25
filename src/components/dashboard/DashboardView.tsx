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
import Link from 'next/link'
import { MapPin, X, Loader2, Star, Trash2, Target, Boxes } from 'lucide-react'
import KPICards from './KPICards'
import OpportunityList from './OpportunityList'
import AlertsFeed from './AlertsFeed'
import DashboardCharts from './DashboardCharts'
import ConcorrentesWidget from './ConcorrentesWidget'
import { TIPO_LABEL } from '@/lib/categorias'
import type { Oportunidade } from '@/lib/types'
import {
  getSavedViews, createSavedView, deleteSavedView, savedViewExists,
  getLastFilter, setLastFilter, type SavedView, type DashboardFilter,
} from '@/lib/saved-views'
import { getTerritorio, setTerritorio } from '@/lib/territorio'
import { getProdutos, type ProdutoPortfolio } from '@/lib/portfolio'
import { getPreferences } from '@/lib/preferences'
import { HYDRATED_EVENT } from '@/lib/synced'
import TerritorioToggle from '@/components/ui/TerritorioToggle'

// Um filtro só "conta" como escolha explícita do usuário se tiver UF ou tipo — um
// last-filter vazio ({}) é gravado na 1ª busca e não deve bloquear a personalização.
function filtroExplicito(f: DashboardFilter | null): boolean {
  return !!f && (!!f.uf || !!f.tipo)
}

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
  const [terrAtivo, setTerrAtivo] = useState(false)
  const [terr, setTerr] = useState<string[]>([])
  const [produtos, setProdutos] = useState<ProdutoPortfolio[]>([]) // portfólio → prioriza leads
  const [personalizado, setPersonalizado] = useState(false)        // dashboard semeado pelo setup

  const [oppData, setOppData] = useState<OpportunitiesData | null>(null)
  const [oppLoading, setOppLoading] = useState(true)
  const [oppError, setOppError] = useState(false)

  // Território ativo comanda o multi-UF; senão vale o seletor de UF única.
  const usandoTerritorio = terrAtivo && terr.length > 0
  const filtros = { uf: usandoTerritorio ? undefined : (uf || undefined), tipo: tipo === 'todos' ? undefined : tipo }
  const ativo = !!uf || tipo !== 'todos' || usandoTerritorio
  const ufsKey = usandoTerritorio ? terr.join(',') : ''

  // Personaliza o dashboard pelo SETUP DO CLIENTE (preferências da conta): na 1ª
  // visita, sem filtro escolhido nem território salvo, semeia as UFs de atuação —
  // assim a home já abre focada no que é do vendedor, não em "Brasil / Todos".
  function personalizarPeloSetup() {
    if (filtroExplicito(getLastFilter())) return   // usuário já escolheu um filtro
    if (getTerritorio().length) return             // já tem território definido
    const prefs = getPreferences()
    if (!prefs.ufs.length) return
    const seed = setTerritorio(prefs.ufs)
    if (!seed.length) return
    setTerr(seed)
    if (seed.length > 1) setTerrAtivo(true)         // multi-UF → território
    else setUf(seed[0])                             // uma UF → seletor simples
    setPersonalizado(true)
  }

  // Ao montar: carrega filtros salvos, portfólio, território e restaura o último
  // filtro aplicado; se for a 1ª visita, personaliza pelo setup do cliente.
  useEffect(() => {
    setViews(getSavedViews())
    setProdutos(getProdutos())
    setTerr(getTerritorio())
    const last = getLastFilter()
    if (filtroExplicito(last)) {
      if (last!.uf) setUf(last!.uf)
      if (last!.tipo) setTipo(last!.tipo)
    } else {
      personalizarPeloSetup()
    }

    // Após o login, os dados da conta são hidratados de forma assíncrona: recarrega
    // o portfólio (p/ os selos) e re-tenta a personalização com as preferências já sincronizadas.
    const onHidratado = () => {
      setProdutos(getProdutos())
      personalizarPeloSetup()
    }
    window.addEventListener(HYDRATED_EVENT, onHidratado)
    return () => window.removeEventListener(HYDRATED_EVENT, onHidratado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Uma única busca de oportunidades por filtro — compartilhada por KPIs, lista e gráfico.
  useEffect(() => {
    let cancelado = false
    setOppLoading(true)
    setOppError(false)
    if (!usandoTerritorio) setLastFilter(filtros) // memoriza o filtro p/ restaurar (exceto território)
    const params = new URLSearchParams({ limit: '300', minScore: '0' })
    if (usandoTerritorio) params.set('ufs', ufsKey)
    else if (filtros.uf) params.set('uf', filtros.uf)
    if (filtros.tipo) params.set('tipo', filtros.tipo)
    fetch(`/api/opportunities?${params}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { if (!cancelado) setOppData(d) })
      .catch(() => { if (!cancelado) setOppError(true) })
      .finally(() => { if (!cancelado) setOppLoading(false) })
    return () => { cancelado = true }
  }, [filtros.uf, filtros.tipo, usandoTerritorio, ufsKey])

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
            disabled={usandoTerritorio}
            title={usandoTerritorio ? 'Território ativo comanda as UFs' : undefined}
            className="text-[12px] bg-bg2 border border-subtle rounded-md px-2 py-1.5 text-strong focus:border-accent outline-none disabled:opacity-50"
          >
            <option value="">Brasil (todas UFs)</option>
            {UFS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <TerritorioToggle ativo={terrAtivo} onToggle={setTerrAtivo} />

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

      {/* Faixa de personalização — deixa explícito que a home reflete o setup do cliente */}
      {produtos.filter((p) => p.ativo).length > 0 ? (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 text-[11px]">
          <Target size={13} className="text-accent flex-shrink-0" />
          <span className="text-strong">
            Priorizando pelo seu portfólio — <strong>{produtos.filter((p) => p.ativo).length} produto(s)</strong> ativos
            {personalizado && terr.length > 0 && <> · {terr.length} UF(s) do seu território</>}.
          </span>
          <Link href="/portfolio" className="ml-auto text-accent hover:underline whitespace-nowrap flex-shrink-0">Ajustar setup →</Link>
        </div>
      ) : (
        <Link
          href="/portfolio"
          className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-bg3 border border-subtle2 border-dashed text-[11px] hover:border-accent/40 transition-colors group"
        >
          <Boxes size={13} className="text-faint group-hover:text-accent flex-shrink-0" />
          <span className="text-muted group-hover:text-strong">
            Configure seu <strong>portfólio</strong> e suas <strong>UFs de atuação</strong> para o dashboard priorizar as oportunidades certas.
          </span>
          <span className="ml-auto text-accent whitespace-nowrap flex-shrink-0">Configurar →</span>
        </Link>
      )}

      {/* KPIs */}
      <KPICards data={oppData} loading={oppLoading} tipo={filtros.tipo} />

      {/* Oportunidades + Alertas/Concorrentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="bg-bg2 border border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="font-heading font-semibold text-[13px] text-strong">
              Oportunidades prioritárias
            </span>
          </div>
          <OpportunityList data={oppData} loading={oppLoading} error={oppError} limit={6} produtos={produtos} />
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
