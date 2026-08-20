'use client'
// src/app/oportunidades/page.tsx — Análise Vencedores (referencia1)

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { Oportunidade } from '@/lib/types'
import type { ItemPNCP } from '@/lib/pncp'
import { clsx } from 'clsx'
import { Search, ExternalLink, Calendar, Hash, ChevronDown, ChevronUp, LayoutList, Table2, Package, Building2, Newspaper, Target, MapPin, X } from 'lucide-react'
import { ExportButton } from '@/components/ui/ExportButton'
import { SetupFilterHint } from '@/components/ui/SetupFilterHint'
import { Paginacao } from '@/components/ui/Paginacao'
import { PageSizeSelector, PAGE_SIZE_PADRAO } from '@/components/ui/PageSizeSelector'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
// Preço de referência Compras.gov RELIGADO no breakdown por item, agora só onde há
// PDM do CATMAT casado (ver PrecoRefItem e scripts/casar-pdm.mjs).
import { PrecoRefItem } from '@/components/ui/PrecoRefItem'
import { AddToCRMButton } from '@/components/ui/AddToCRMButton'
import AcoesLicitacao from './components/AcoesLicitacao'
import { ThSort, useOrdenacao } from '@/components/ui/ThSort'
// Dossiê de edital DESATIVADO nas Licitações (a pedido). Reativar: descomentar.
// import { AbrirDossieButton } from '@/components/ui/AbrirDossieButton'
import { CATEGORIA_LABEL_CURTO as CATEGORIA_LABEL, CATEGORIA_COLOR, TIPO_LABEL as TIPO_LABEL_BASE } from '@/lib/categorias'
import { formatBRL, formatDate, diasRestantes } from '@/lib/format'
import { getProdutos, type ProdutoPortfolio } from '@/lib/portfolio'
import { getTerritorio } from '@/lib/territorio'
import { getPreferences } from '@/lib/preferences'
import { useSetupFiltro } from '@/lib/use-setup-filtro'
import { HYDRATED_EVENT } from '@/lib/synced'
import { publishDataStatus } from '@/lib/data-status'

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIAS = [
  'todos', 'imagem', 'uti', 'laboratorio', 'cirurgia', 'oncologia', 'medicamento',
  'material_hospitalar', 'equipamento_medico', 'servicos_medicos',
  'odontologia', 'ambulancia', 'manutencao', 'opme', 'outros',
]

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

// ── ItemsRow: itens (equipamentos/acessórios) de uma oportunidade ────────────
// Usa os itens já pré-carregados em lote (banco); se não vierem, faz fetch
// individual no PNCP como fallback.

function ItemsRow({ opp, preloaded }: { opp: Oportunidade; preloaded?: ItemPNCP[] }) {
  const [itens, setItens] = useState<ItemPNCP[]>(preloaded ?? [])
  const [loading, setLoading] = useState(!preloaded)

  const lic = opp.licitacaoRelacionada

  useEffect(() => {
    if (preloaded) { setItens(preloaded); setLoading(false); return }
    const parsed = parsePNCPNum(lic?.numeroControlePNCP)
    const cnpj = lic?.orgaoEntidade?.cnpj
    if (!parsed || !cnpj) { setLoading(false); return }

    fetch(`/api/itens?cnpj=${cnpj}&ano=${parsed.ano}&seq=${parsed.seq}`)
      .then((r) => r.json())
      .then((json) => setItens(json.itens ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [opp.id, lic?.numeroControlePNCP, lic?.orgaoEntidade?.cnpj, preloaded])

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
            <span className="text-[11px] text-strong flex-1 leading-snug min-w-0">{item.descricao}</span>
            <span className="text-[10px] font-mono-custom text-faint flex-shrink-0 whitespace-nowrap mt-0.5">
              {item.quantidade} {item.unidadeMedida}
            </span>
            {/* Valor UNITÁRIO (total ÷ quantidade) — base de comparação justa com o
                Compras.gov, cuja referência é sempre por unidade. */}
            <span className="flex-shrink-0 whitespace-nowrap mt-0.5 w-24 text-right leading-tight">
              <span className="block text-[11px] font-mono-custom font-bold text-strong">
                {formatBRL(item.quantidade > 0 ? (item.quantidade * item.valorUnitarioEstimado) / item.quantidade : item.valorUnitarioEstimado)}
              </span>
              <span className="block text-[8px] font-mono-custom text-faint uppercase tracking-wide">unitário</span>
            </span>
            <span className="flex-shrink-0 whitespace-nowrap mt-0.5 w-24 text-right leading-tight">
              <span className="block text-[11px] font-mono-custom font-bold text-accent">
                {formatBRL(item.quantidade * item.valorUnitarioEstimado)}
              </span>
              <span className="block text-[8px] font-mono-custom text-faint uppercase tracking-wide">total</span>
            </span>
            {/* Preço de referência RELIGADO, mas só onde há PDM do CATMAT casado.
                Foi desligado porque dava valores estranhos, e a causa era dupla:
                (1) a chamada ao Painel de Preços estava errada (mandava
                `codigoItemCatalogo` para um endpoint que exige `tipo`+`codigo`, e
                respondia 404 em 100% dos casos), e (2) só 0,18% dos itens tinham
                CATMAT, então a referência caía em aproximação por texto e trazia
                outro produto. Com PDM casado (44% dos itens) a consulta é por
                código; sem PDM não mostramos nada, porque referência errada é pior
                que referência ausente. */}
            {item.codigoPdm && (
              <PrecoRefItem
                descricao={item.descricao}
                valorUnitario={item.valorUnitarioEstimado}
                uf={opp.uf}
                unidadeEdital={item.unidadeMedida}
                codigoPdm={item.codigoPdm}
                nomePdm={item.nomePdm}
              />
            )}
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

// Teto de linhas por export. É o MESMO teto que /api/opportunities aplica por
// requisição (buscarDoBanco: LIMIT máx. 4000) — pedir mais devolveria 4.000 de
// qualquer forma, calado. Quando o filtro passa disso, o usuário é avisado do corte
// antes do download em vez de descobrir contando linhas na planilha.
const EXPORT_MAX = 4000

interface OpportunitiesResponse {
  oportunidades: Oportunidade[]
  totais: { total: number; valorTotal: number; abertas: number; estados: number; municipios: number; universo: number; comValor: number } | null
  porTipo: Record<string, number> | null
}

function OportunidadesInner() {
  const searchParams = useSearchParams()

  // Filters
  const [tipo, setTipo] = useState(searchParams.get('tipo') ?? 'todos')
  const [query, setQuery] = useState('')
  const [queryDebounced, setQueryDebounced] = useState('')
  const [queryProponente, setQueryProponente] = useState('')
  const [queryProponenteDebounced, setQueryProponenteDebounced] = useState('')
  // Filtro por cidade vindo do deep-link do mapa (?municipio=). Escopado pela UF.
  const [municipioFiltro, setMunicipioFiltro] = useState(searchParams.get('municipio') ?? '')
  const [queryConvenio, setQueryConvenio] = useState('')
  const [queryConvenioDebounced, setQueryConvenioDebounced] = useState('')
  const [categoria, setCategoria] = useState('todos')
  const [ufsAtivos, setUfsAtivos] = useState<Set<string>>(
    () => { const u = searchParams.get('uf'); return u ? new Set(u.toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)) : new Set() },
  )
  const ufsKey = useMemo(() => [...ufsAtivos].sort().join(','), [ufsAtivos])
  // Quando o usuário mexe manualmente no filtro de UF, paramos de aplicar o default
  // do Setup da Empresa (senão sobrescreveríamos a escolha dele a cada hidratação).
  const ufTocadoRef = useRef(false)
  const marcarUFTocado = () => { ufTocadoRef.current = true }
  const [terrUFs, setTerrUFs] = useState<string[]>([])
  useEffect(() => { setTerrUFs(getTerritorio()) }, [])

  // Item 4 — pré-filtra pelos ESTADOS DO SETUP DA EMPRESA. Ao entrar em Licitações
  // sem deep-link de UF e sem o usuário ter mexido no filtro, aplica as UFs de
  // atuação salvas no Setup. Re-tenta quando a conta termina de hidratar do servidor
  // (as prefs chegam de forma assíncrona logo após o login).
  // `setupResolvido` libera a 1a busca só quando já se sabe QUAIS UFs pedir — senão
  // a tela dispara uma busca nacional que é jogada fora.
  const [setupResolvido, setSetupResolvido] = useState(false)
  useEffect(() => {
    const aplicarSetup = () => {
      if (ufTocadoRef.current) return
      if (searchParams.get('uf')) return            // deep-link (mapa/dashboard) tem prioridade
      const doSetup = getPreferences().ufs
      if (doSetup.length === 0) return
      setUfsAtivos(new Set(doSetup))
      setTerrUFs(getTerritorio())
    }
    aplicarSetup()
    const liberar = () => setSetupResolvido(true)
    // Já dá para buscar: veio deep-link, ou o Setup desta conta já está no cache.
    if (searchParams.get('uf') || getPreferences().ufs.length > 0) liberar()
    // Senão espera a conta hidratar do servidor (as prefs chegam logo após o login).
    // O timer é a rede de segurança: conta sem UFs salvas não pode ficar presa.
    const backstop = setTimeout(liberar, 2500)
    const aoHidratar = () => { aplicarSetup(); liberar() }
    window.addEventListener(HYDRATED_EVENT, aoHidratar)
    return () => { clearTimeout(backstop); window.removeEventListener(HYDRATED_EVENT, aoHidratar) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Território ativo = ufsAtivos exatamente igual ao conjunto do território.
  const territorioAtivo = terrUFs.length > 0 && terrUFs.length === ufsAtivos.size && terrUFs.every((u) => ufsAtivos.has(u))
  const [anoFiltro, setAnoFiltro] = useState(() => {
    // Deep-link do dashboard (?opp=): abre em "todos os anos" p/ não filtrar fora o lead.
    if (searchParams.get('opp')) return 'todos'
    const a = searchParams.get('ano'); return a && /^\d{4}$/.test(a) ? a : 'todos'
  })
  // Default: abertas (as que ainda dá para disputar). Encerradas (já homologadas)
  // são muito mais — ao escolher "Encerrado" pré-selecionamos um ano p/ não pesar.
  // Deep-link do dashboard (?opp=): status "todos" para NÃO esconder a licitação clicada.
  const [statusFiltro, setStatusFiltro] = useState(() => {
    if (searchParams.get('opp')) return 'todos'
    const s = searchParams.get('status'); return s === 'aberto' || s === 'encerrado' || s === 'todos' ? s : 'aberto'
  })
  const [minScore, setMinScore] = useState(Number(searchParams.get('minScore') ?? 0) || 0)
  const [viewMode, setViewMode] = useState<'tabela' | 'cards'>('tabela')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [produtos, setProdutos] = useState<ProdutoPortfolio[]>([])
  const [soPortfolio, setSoPortfolio] = useState(false)
  // "Tirar todos os filtros": além das UFs do Setup, solta os recortes que também
  // nascem dele (portfólio, categoria, município) — é o que "ver tudo" quer dizer aqui.
  const { semSetup, limpar, restaurar } = useSetupFiltro({
    aplicarUfs: (u) => setUfsAtivos(new Set(u)),
    marcarTocado: marcarUFTocado,
    aoTrocar: () => { setSoPortfolio(false); setCategoria('todos'); setMunicipioFiltro('') },
  })
  // Itens (equipamentos/acessórios) pré-carregados em lote, por nº de controle PNCP
  // — alimenta a pré-análise (especificação, quantidade, valor) sem abrir o PNCP.
  // Busca por item/equipamento ("luvas cirúrgicas") agora é feita no SERVIDOR (via
  // `q`), não depende mais deste mapa — só o breakdown expandido usa.
  const [itensMap, setItensMap] = useState<Record<string, ItemPNCP[]>>({})
  const [itensProntos, setItensProntos] = useState(0)
  const [itensTotal, setItensTotal] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_PADRAO) // itens por página (50 padrão)
  const [pagina, setPagina] = useState(1)
  const { ordem, alternar } = useOrdenacao<'proponente' | 'status' | 'item' | 'valor' | 'ano' | 'score'>()

  // Carrega o portfólio do fornecedor (localStorage) para o filtro "Meu Portfólio".
  useEffect(() => { setProdutos(getProdutos()) }, [])
  const temPortfolio = produtos.some((p) => p.ativo)

  // Deep-link vindo do dashboard (?opp=<id>): a licitação clicada é expandida, a lista
  // salta para a PÁGINA em que ela está (localizada no servidor — ver efeito abaixo),
  // rola até o centro e destaca.
  const focusId = searchParams.get('opp')
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const toggle = (id: string) =>
    setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })

  const toggleUF = (uf: string) => {
    marcarUFTocado()
    setUfsAtivos((p) => { const s = new Set(p); s.has(uf) ? s.delete(uf) : s.add(uf); return s })
  }

  // Debounce da busca livre / proponente / convênio antes de virarem filtro do
  // SERVIDOR — mesmo padrão de fornecedores/page.tsx e vencedores/page.tsx.
  useEffect(() => { const t = setTimeout(() => setQueryDebounced(query.trim()), 350); return () => clearTimeout(t) }, [query])
  useEffect(() => { const t = setTimeout(() => setQueryProponenteDebounced(queryProponente.trim()), 350); return () => clearTimeout(t) }, [queryProponente])
  useEffect(() => { const t = setTimeout(() => setQueryConvenioDebounced(queryConvenio.trim()), 350); return () => clearTimeout(t) }, [queryConvenio])

  // Reinicia o lote visível sempre que um filtro do SERVIDOR muda (tudo, já que todo
  // filtro agora vai ao servidor). Trocar filtro/página encolher e continuar na
  // página 7 mostraria vazio sem dizer por quê.
  useEffect(() => {
    setPagina(1)
  }, [pageSize, tipo, statusFiltro, anoFiltro, categoria, queryDebounced, queryProponenteDebounced, queryConvenioDebounced, minScore, soPortfolio, ufsKey, municipioFiltro, ordem.chave, ordem.dir])

  const filtrosParams = useCallback(() => {
    // Status/ano/tipo/busca/portfólio/ordenação vão ao servidor — os KPIs refletem
    // o total real do filtro e a página busca só o que será mostrado.
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((pagina - 1) * pageSize),
    })
    if (minScore > 0) params.set('minScore', String(minScore))
    if (categoria !== 'todos') params.set('categoria', categoria)
    if (statusFiltro !== 'todos') params.set('status', statusFiltro)
    if (anoFiltro !== 'todos') params.set('ano', anoFiltro)
    if (tipo !== 'todos') params.set('tipo', tipo)
    // Filtro por cidade (deep-link do mapa): manda município + a UF para o servidor
    // (evita misturar cidades homônimas de estados diferentes) — KPIs batem com o mapa.
    if (municipioFiltro) {
      params.set('municipio', municipioFiltro)
      const ufDL = searchParams.get('uf')
      if (ufDL) params.set('uf', ufDL.split(',')[0])
    } else if (ufsKey) {
      // UF filtrada no SERVIDOR (não só no cliente): os KPIs/contagens batem com o
      // filtro e a licitação clicada no dashboard entra no conjunto carregado.
      params.set('ufs', ufsKey)
    }
    if (queryDebounced) params.set('q', queryDebounced)
    if (queryProponenteDebounced) params.set('proponente', queryProponenteDebounced)
    if (queryConvenioDebounced) params.set('convenio', queryConvenioDebounced)
    // "Meu Portfólio" vai como INTERRUPTOR, não como conteúdo: quem resolve os
    // produtos é o servidor, pela conta (ver src/lib/portfolio-servidor.ts). Antes as
    // palavras-chave — nomes, marcas e modelos do que o cliente vende — iam serializadas
    // na query string, e catálogo de cliente não pode passear por log de proxy/CDN/APM
    // (fora que com muitos produtos a URL estourava e virava HTTP 414).
    if (soPortfolio) params.set('portfolio', '1')
    if (ordem.chave) { params.set('sort', ordem.chave); params.set('dir', ordem.dir) }
    return params
  }, [pageSize, pagina, minScore, categoria, statusFiltro, anoFiltro, tipo, municipioFiltro, ufsKey, searchParams, queryDebounced, queryProponenteDebounced, queryConvenioDebounced, soPortfolio, ordem])

  // Uma query por combinação de filtros+página — o React Query cacheia cada uma
  // (staleTime/gcTime em QueryProvider), então voltar a uma página JÁ vista não
  // refaz o fetch (instantâneo). Uma página NOVA (ainda não cacheada) limpa `data`
  // e mostra o loading de novo — sem placeholderData/keepPreviousData, que deixava
  // a página anterior na tela enquanto a nova carregava (confuso com o load lento
  // de agora). `enabled` espera o Setup resolver (evita 1 busca nacional jogada
  // fora antes das UFs do Setup chegarem).
  const { data, isLoading, isFetching } = useQuery<OpportunitiesResponse>({
    queryKey: ['oportunidades', filtrosParams().toString()],
    queryFn: async ({ signal }) => {
      const params = filtrosParams()
      const res = await fetch(`/api/opportunities?${params}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      publishDataStatus(json)
      return json
    },
    enabled: setupResolvido,
  })
  // Memoizado: sem isto, `data?.oportunidades ?? []` cria um array [] novo a cada
  // render quando não há dados, e o efeito de pré-carga de itens (que depende de
  // `visible`) rodaria de novo a cada render em vez de só quando a página muda.
  const visible = useMemo(() => data?.oportunidades ?? [], [data])
  const totais = data?.totais
  const porTipo = data?.porTipo ?? null

  // Export do FILTRO, não da página. Com a paginação de verdade a tela só tem ~50
  // linhas em memória; passar `visible` para o ExportButton entregava essas 50 como
  // se fossem o resultado da busca — regressão silenciosa contra o comportamento
  // anterior (que exportava todo o conjunto filtrado). Aqui a mesma busca é refeita
  // sem offset e com o teto explícito, e o corte é declarado quando existe.
  const exportarFiltro = useCallback(async (): Promise<Oportunidade[] | null> => {
    const total = totais?.total ?? 0
    if (total > EXPORT_MAX) {
      const ok = window.confirm(
        `O filtro atual tem ${total.toLocaleString('pt-BR')} licitações. `
        + `O arquivo leva as primeiras ${EXPORT_MAX.toLocaleString('pt-BR')} na ordenação da tela — `
        + `estreite o filtro para levar tudo.\n\nBaixar assim?`,
      )
      if (!ok) return null
    }
    const params = filtrosParams()
    params.set('limit', String(EXPORT_MAX))
    params.set('offset', '0')
    const res = await fetch(`/api/opportunities?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: OpportunitiesResponse = await res.json()
    return json.oportunidades ?? []
  }, [filtrosParams, totais])

  // Pré-carrega os itens (equipamentos) só da PÁGINA atual (≤ pageSize, não mais até
  // 1.500) — habilita a pré-análise expandida sem abrir o PNCP.
  useEffect(() => {
    const ids = Array.from(new Set(
      visible.map((o) => o.licitacaoRelacionada?.numeroControlePNCP).filter((x): x is string => !!x)
    ))
    setItensMap({}); setItensProntos(0); setItensTotal(ids.length)
    if (ids.length === 0) return
    let cancelled = false
    const CHUNK = 300
    ;(async () => {
      for (let i = 0; i < ids.length && !cancelled; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        try {
          const r = await fetch('/api/itens-lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: slice }),
          })
          const j: { itens?: Record<string, ItemPNCP[]> } = await r.json()
          if (!cancelled) setItensMap((p) => ({ ...p, ...(j.itens ?? {}) }))
        } catch { /* segue para o próximo bloco */ }
        if (!cancelled) setItensProntos((n) => n + slice.length)
      }
    })()
    return () => { cancelled = true }
  }, [visible])

  // Sincroniza a aba de tipo quando a URL muda (links da sidebar "Por Tipo")
  useEffect(() => { setTipo(searchParams.get('tipo') ?? 'todos') }, [searchParams])

  // KPIs — sempre os totais REAIS do filtro (servidor), independente de quantas
  // oportunidades vieram na página. Cobrem busca livre/portfólio também (o backend
  // aplica os mesmos filtros no cálculo dos totais).
  const totalLic = totais?.total ?? 0
  const valorTotal = totais?.valorTotal ?? 0
  const abertos = totais?.abertas ?? 0
  const universoLic = totais?.universo ?? totalLic
  const estados = totais?.estados ?? 0
  const comValor = totais?.comValor ?? totalLic
  const ticketMedio = comValor ? valorTotal / comValor : 0

  // Deep-link (?opp=): localiza a página no SERVIDOR (mesmo filtro/ordenação ativos)
  // em vez de carregar o universo inteiro no client para achar o índice.
  const focusParamsKey = useMemo(() => {
    if (!focusId) return null
    const p = filtrosParams()
    p.delete('offset')
    return p.toString()
  }, [focusId, filtrosParams])
  const localizadoRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusId || !setupResolvido || !focusParamsKey) return
    const chave = `${focusId}:${focusParamsKey}`
    if (localizadoRef.current === chave) return
    let vivo = true
    ;(async () => {
      try {
        const params = new URLSearchParams(focusParamsKey)
        params.set('localizarId', focusId)
        const r = await fetch(`/api/opportunities?${params}`)
        const j: { pagina: number | null } = await r.json()
        if (!vivo) return
        localizadoRef.current = chave
        if (j.pagina) setPagina(j.pagina)
      } catch { /* mantém a página atual */ }
    })()
    return () => { vivo = false }
  }, [focusId, focusParamsKey, setupResolvido])

  // Aceita tanto o id da oportunidade (`pncp-<nºcontrole>`) quanto o nº de controle
  // PNCP "cru" — Portais Estaduais e outros linkadores mandam o controle sem prefixo.
  const focusOpp = focusId
    ? visible.find((o) =>
        o.id === focusId ||
        o.id === `pncp-${focusId}` ||
        o.licitacaoRelacionada?.numeroControlePNCP === focusId,
      )
    : undefined
  const focusRealId = focusOpp?.id ?? null
  useEffect(() => {
    if (!focusRealId || isLoading) return
    setExpanded((p) => new Set(p).add(focusRealId))
    setHighlightId(focusRealId)
    const t = setTimeout(() => {
      document.getElementById(`opp-${focusRealId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 220)
    const t2 = setTimeout(() => setHighlightId(null), 2800)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [focusRealId, isLoading])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title={tipo === 'todos' ? 'Análise de Licitações' : `Licitações · ${TIPO_LABEL[tipo] ?? tipo}`}
          subtitle={isFetching
            ? 'Carregando…'
            : `${totalLic} no filtro${itensTotal > 0 && itensProntos < itensTotal ? ' · indexando itens…' : ''}`}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* Chip de filtro por cidade (deep-link do mapa) */}
          {municipioFiltro && (
            <div className="flex items-center gap-2 mb-4 bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 w-fit">
              <MapPin size={13} className="text-accent" />
              <span className="text-[12px] text-strong">
                Filtrando por cidade: <strong>{municipioFiltro}</strong>
                {ufsAtivos.size === 1 && <span className="text-faint font-mono-custom"> / {[...ufsAtivos][0]}</span>}
              </span>
              <button
                onClick={() => { marcarUFTocado(); setMunicipioFiltro(''); setUfsAtivos(new Set()) }}
                title="Remover filtro de cidade"
                className="ml-1 text-faint hover:text-strong transition-colors"><X size={13} /></button>
            </div>
          )}

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
                  {porTipo
                    ? (t.key === 'todos' ? Object.values(porTipo).reduce((a, b) => a + b, 0) : (porTipo[t.key] ?? 0))
                    : (t.key === 'todos' ? visible.length : visible.filter((o) => (o.tipoFornecimento ?? 'outros') === t.key).length)}
                </span>
              </button>
            ))}
          </div>

          {/* ── KPI strip ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Valor total', value: formatBRL(valorTotal), sub: 'estimado' },
              { label: 'Ticket médio', value: formatBRL(ticketMedio),
                sub: comValor < totalLic ? `entre as ${comValor.toLocaleString('pt-BR')} com valor` : 'por licitação' },
              // Denominador = o mesmo recorte SEM o filtro de aberto/encerrado. Com o
              // `totalLic` (que já é filtrado) a linha lia "50.241 de 50.241 total".
              { label: 'Em aberto', value: String(abertos), sub: `de ${universoLic} no recorte` },
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
                <button key={k} onClick={() => {
                  setStatusFiltro(k)
                  // Encerradas são ~10 mil: se nenhum ano estiver escolhido, pré-seleciona 2025.
                  if (k === 'encerrado' && anoFiltro === 'todos') setAnoFiltro('2025')
                }}
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
              data={visible}
              fetchAll={exportarFiltro}
              filename="licitacoes"
              title="Licitações GovHealth AI"
              columns={[
                { key: 'descricao', label: 'Descrição' },
                { key: 'hospital', label: 'Proponente', format: (_v, row) => row.hospital ?? row.municipio ?? '' },
                { key: 'licitacaoRelacionada', label: 'Convênio / PNCP', format: (_v, row) => row.licitacaoRelacionada?.numeroControlePNCP ?? '' },
                { key: 'categoria', label: 'Categoria' },
                { key: 'uf', label: 'UF' },
                { key: 'municipio', label: 'Município' },
                { key: 'score', label: 'Score' },
                // "não informado" e não "R$ 0": 72% da base não traz valor, e exportar
                // zero faria a planilha do cliente somar como se fossem gratuitas.
                { key: 'valorEstimado', label: 'Valor Estimado',
                  format: (v) => Number(v) > 0 ? `R$ ${Number(v).toLocaleString('pt-BR')}` : 'não informado' },
                { key: 'status', label: 'Status' },
                { key: 'urgencia', label: 'Urgência' },
              ]}
            />

            <PageSizeSelector value={pageSize} onChange={setPageSize} className="bg-bg2 border border-subtle2 rounded-lg px-2 py-1.5" />

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

          <SetupFilterHint estados className="mb-3" onLimpar={limpar} onRestaurar={restaurar} limpo={semSetup} />

          {/* ── UF bar (multi-select) ─────────────────────────────────────── */}
          <div className="bg-bg2 border border-subtle2 rounded-xl px-3 py-2.5 mb-3">
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => { marcarUFTocado(); setUfsAtivos(new Set()) }}
                className={clsx('text-[10px] font-mono-custom px-2.5 py-1 rounded-md transition-all',
                  ufsAtivos.size === 0 ? 'bg-accent text-black font-bold' : 'text-muted hover:text-strong hover:bg-bg3')}>
                Todos
              </button>
              {terrUFs.length > 0 && (
                <button
                  onClick={() => { marcarUFTocado(); setUfsAtivos(territorioAtivo ? new Set() : new Set(terrUFs)) }}
                  title={`Aplicar as ${terrUFs.length} UF(s) do seu território`}
                  className={clsx('flex items-center gap-1 text-[10px] font-mono-custom px-2.5 py-1 rounded-md border transition-all',
                    territorioAtivo ? 'bg-accent/15 text-accent border-accent/40 font-semibold' : 'border-accent/30 text-accent hover:bg-accent/10')}>
                  <Target size={11} /> Meu território ({terrUFs.length})
                </button>
              )}
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
              { value: query, set: setQuery, placeholder: 'Item, equipamento, município, CNPJ… (ex: luvas cirúrgicas)' },
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
          {isLoading ? (
            <div className="bg-bg2 border border-subtle rounded-xl p-10 text-center text-faint text-[13px]">
              Carregando…
            </div>
          ) : visible.length === 0 ? (
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
                    <ThSort chave="proponente" ordem={ordem} onOrdenar={alternar} className="px-4 py-2.5">Proponente</ThSort>
                    <th className="text-left text-[9px] font-mono-custom text-faint uppercase tracking-wider px-3 py-2.5">Convênio / PNCP</th>
                    <ThSort chave="status" ordem={ordem} onOrdenar={alternar} className="px-3 py-2.5">Status</ThSort>
                    <ThSort chave="item" ordem={ordem} onOrdenar={alternar} className="px-4 py-2.5">Item</ThSort>
                    <ThSort chave="valor" ordem={ordem} onOrdenar={alternar} align="right" className="px-4 py-2.5">Valor</ThSort>
                    <ThSort chave="ano" ordem={ordem} onOrdenar={alternar} align="center" className="px-3 py-2.5">Ano</ThSort>
                    <ThSort chave="score" ordem={ordem} onOrdenar={alternar} align="center" className="px-3 py-2.5">Score</ThSort>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((opp, idx) => {
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
                          <td className="px-3 py-2.5 text-[10px] text-faint font-mono-custom">{(pagina - 1) * pageSize + idx + 1}</td>
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
                                    {lic && <AcoesLicitacao lic={lic} uf={opp.uf} />}
                                    {/* Dossiê de edital desativado nas Licitações (a pedido).
                                        Reativar: descomentar. <AbrirDossieButton oportunidade={opp} /> */}
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
                              {/* Itens em largura total — não espremer no grid de 2 colunas */}
                              <ItemsRow opp={opp} preloaded={itensMap[opp.licitacaoRelacionada?.numeroControlePNCP ?? '']} />
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
              {visible.map((opp) => {
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
                              {lic && <AcoesLicitacao lic={lic} uf={opp.uf} />}
                              {/* Dossiê de edital desativado nas Licitações (a pedido).
                                  Reativar: descomentar. <AbrirDossieButton oportunidade={opp} /> */}
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
                        {/* Itens em largura total — não espremer no grid de 2 colunas */}
                        <ItemsRow opp={opp} preloaded={itensMap[opp.licitacaoRelacionada?.numeroControlePNCP ?? '']} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!isLoading && (
            <Paginacao
              pagina={pagina} totalItens={totalLic} porPagina={pageSize}
              onPagina={setPagina} rotuloItens="licitações"
              className="mt-4 bg-bg2 border border-subtle2 rounded-lg"
            />
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
