'use client'
// src/components/dashboard/DashboardView.tsx
// Casca client do dashboard: mantém o estado dos filtros (ESTADOS multi-seleção +
// Tipo de fornecimento) e o propaga para TODOS os widgets — KPIs, oportunidades,
// gráfico e alertas reagem juntos ao filtro aplicado.
//
// Os ESTADOS já vêm PRÉ-SELECIONADOS pelo Setup da Empresa (getPreferences().ufs) —
// via useSetupUFDefault — e comandam a busca no SERVIDOR (ufs=...), então o dashboard
// não mistura licitações de outras UFs. O usuário pode ajustar a seleção à vontade.
//
// Performance: `/api/opportunities` é buscado UMA vez aqui e o resultado
// (oportunidades + KPIs + série mensal + categorias) é passado por props para
// KPICards, OpportunityList e DashboardCharts. Alertas têm endpoint próprio.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { clsx } from 'clsx'
import Link from 'next/link'
import { X, Loader2, Star, Trash2, Target, Boxes } from 'lucide-react'
import KPICards from './KPICards'
import OpportunityList from './OpportunityList'
import AlertsFeed from './AlertsFeed'
import DashboardCharts from './DashboardCharts'
import { TIPO_LABEL } from '@/lib/categorias'
import type { Oportunidade } from '@/lib/types'
import {
  getSavedViews, createSavedView, deleteSavedView, savedViewExists,
  type SavedView, type DashboardFilter,
} from '@/lib/saved-views'
import { getProdutos, type ProdutoPortfolio } from '@/lib/portfolio'
import { HYDRATED_EVENT, foiHidratado } from '@/lib/synced'
import { isOnboarded } from '@/lib/onboarding'
import { useSetupUFDefault } from '@/lib/use-setup-uf'

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
  const router = useRouter()
  const { data: session, status } = useSession()
  const email = session?.user?.email ?? null
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null

  // Filtro de ESTADOS (multi) — comanda todos os widgets. Pré-selecionado pelo Setup.
  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(new Set())
  const { marcarTocado: marcarUFTocado } = useSetupUFDefault((ufs) => setUfsAtivos(new Set(ufs)))
  const [tipo, setTipo] = useState<string>('todos')
  const [views, setViews] = useState<SavedView[]>([])
  const [produtos, setProdutos] = useState<ProdutoPortfolio[]>([]) // portfólio → prioriza leads

  const [oppData, setOppData] = useState<OpportunitiesData | null>(null)
  const [oppLoading, setOppLoading] = useState(true)
  const [oppError, setOppError] = useState(false)

  const ufsArr = [...ufsAtivos].sort()
  const ufsKey = ufsArr.join(',')
  const tipoParam = tipo === 'todos' ? undefined : tipo
  const ativo = ufsAtivos.size > 0 || tipo !== 'todos'
  const filtroAtual: DashboardFilter = { uf: ufsKey || undefined, tipo: tipoParam }

  const toggleUF = (u: string) => {
    marcarUFTocado()
    setUfsAtivos((p) => { const s = new Set(p); s.has(u) ? s.delete(u) : s.add(u); return s })
  }

  // Ao montar: carrega filtros salvos e portfólio. Re-carrega o portfólio (p/ os selos)
  // quando a conta termina de hidratar do servidor. Os ESTADOS são semeados pelo Setup
  // via useSetupUFDefault (que também re-tenta no HYDRATED_EVENT).
  useEffect(() => {
    setViews(getSavedViews())
    setProdutos(getProdutos())
    const onHidratado = () => { setProdutos(getProdutos()) }
    window.addEventListener(HYDRATED_EVENT, onHidratado)
    return () => window.removeEventListener(HYDRATED_EVENT, onHidratado)
  }, [])

  // Gate de PRIMEIRO ACESSO: no 1º login (setup ainda não concluído) a primeira tela
  // é o Setup da Empresa. Só decide DEPOIS que o cache da conta foi hidratado do
  // servidor — senão um usuário recorrente em máquina nova (cache local ainda vazio)
  // seria mandado ao setup por engano. Do 2º login em diante o Dashboard abre normal.
  useEffect(() => {
    if (status !== 'authenticated') return
    if (role === 'master') return // admin não passa pelo onboarding
    const decidir = () => {
      if (!foiHidratado(email)) return
      if (!isOnboarded()) router.replace('/perfil?onboarding=1')
    }
    decidir()
    window.addEventListener(HYDRATED_EVENT, decidir)
    return () => window.removeEventListener(HYDRATED_EVENT, decidir)
  }, [status, email, role, router])

  // Uma única busca de oportunidades por filtro — compartilhada por KPIs, lista e gráfico.
  // A UF vai ao SERVIDOR (ufs=), então os dados já vêm restritos aos estados do filtro.
  useEffect(() => {
    let cancelado = false
    setOppLoading(true)
    setOppError(false)
    const params = new URLSearchParams({ limit: '300', minScore: '0' })
    if (ufsKey) params.set('ufs', ufsKey)
    if (tipoParam) params.set('tipo', tipoParam)
    fetch(`/api/opportunities?${params}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { if (!cancelado) setOppData(d) })
      .catch(() => { if (!cancelado) setOppError(true) })
      .finally(() => { if (!cancelado) setOppLoading(false) })
    return () => { cancelado = true }
  }, [ufsKey, tipoParam])

  const tipoLabelDe = (k: string) => TIPOS.find((t) => t.key === k)?.label ?? k

  function aplicar(v: SavedView) {
    marcarUFTocado()
    setUfsAtivos(new Set(v.uf ? v.uf.split(',').filter(Boolean) : []))
    setTipo(v.tipo ?? 'todos')
  }

  function salvarAtual() {
    if (savedViewExists(filtroAtual)) return
    const rotulo = `${ufsKey || 'Brasil'} · ${tipo === 'todos' ? 'Todos' : tipoLabelDe(tipo)}`
    const nome = window.prompt('Nome do filtro salvo:', rotulo)
    if (nome === null) return // cancelou
    createSavedView(nome, filtroAtual)
    setViews(getSavedViews())
  }

  function remover(id: string) {
    deleteSavedView(id)
    setViews(getSavedViews())
  }

  const jaSalvo = savedViewExists(filtroAtual)

  return (
    <>
      {/* Barra de ESTADOS (multi) — pré-selecionada pelo Setup; comanda todos os widgets */}
      <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-mono-custom text-faint uppercase tracking-wider">
            Estados {ufsAtivos.size > 0 && <span className="text-accent">· {ufsAtivos.size} selecionado{ufsAtivos.size !== 1 ? 's' : ''}</span>}
          </span>
          <Link href="/perfil" className="text-[10px] text-faint hover:text-accent transition-colors">Ajustar no Setup →</Link>
        </div>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => { marcarUFTocado(); setUfsAtivos(new Set()) }}
            className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
              ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
            Brasil (todos)
          </button>
          {UFS.map((u) => (
            <button key={u} onClick={() => toggleUF(u)}
              className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                ufsAtivos.has(u) ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Tipo de fornecimento + ações */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
            onClick={() => { marcarUFTocado(); setUfsAtivos(new Set()); setTipo('todos') }}
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
            const selecionado = (v.uf ?? '') === ufsKey && (v.tipo ?? '') === (tipoParam ?? '')
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
            {ufsAtivos.size > 0 && <> · {ufsAtivos.size} UF(s) do seu setup</>}.
          </span>
          <Link href="/perfil?tab=portfolio" className="ml-auto text-accent hover:underline whitespace-nowrap flex-shrink-0">Ajustar setup →</Link>
        </div>
      ) : (
        <Link
          href="/perfil?tab=portfolio"
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
      <KPICards data={oppData} loading={oppLoading} tipo={tipoParam} />

      {/* Oportunidades + Alertas */}
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
            <AlertsFeed ufs={ufsArr} tipo={tipoParam} />
          </div>
        </div>
      </div>

      {/* Charts: tendência + categorias */}
      <DashboardCharts data={oppData} loading={oppLoading} />
    </>
  )
}
