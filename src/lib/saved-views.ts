// src/lib/saved-views.ts — Filtros salvos do dashboard (item #9 do TOP10 v2).
// Persistência em localStorage no mesmo padrão de crm.ts / alertas.ts / portfolio.ts.
// Um SavedView guarda uma combinação de filtros (UF + Tipo de fornecimento) com um
// nome amigável, para o vendedor reaplicar sua "visão" com um clique. É também a
// fundação dos alertas (#5): alerta = filtro salvo + gatilho.

const STORAGE_KEY = 'govhealth:saved-views'
const LAST_FILTER_KEY = 'govhealth:last-filter'

export interface SavedView {
  id: string
  nome: string
  uf?: string
  tipo?: string
  createdAt: string
}

export interface DashboardFilter {
  uf?: string
  tipo?: string
}

export function getSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedView[]) : []
  } catch {
    return []
  }
}

function persist(views: SavedView[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
}

export function createSavedView(nome: string, filtro: DashboardFilter): SavedView {
  const view: SavedView = {
    id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nome: nome.trim() || rotuloFiltro(filtro),
    uf: filtro.uf,
    tipo: filtro.tipo,
    createdAt: new Date().toISOString(),
  }
  persist([view, ...getSavedViews()])
  return view
}

export function deleteSavedView(id: string): void {
  persist(getSavedViews().filter((v) => v.id !== id))
}

/** Já existe um filtro salvo com a MESMA combinação UF+Tipo? (evita duplicados). */
export function savedViewExists(filtro: DashboardFilter): boolean {
  return getSavedViews().some((v) => (v.uf ?? '') === (filtro.uf ?? '') && (v.tipo ?? '') === (filtro.tipo ?? ''))
}

// Último filtro aplicado — restaura a "visão" do usuário ao reabrir o dashboard.
export function getLastFilter(): DashboardFilter | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_FILTER_KEY)
    return raw ? (JSON.parse(raw) as DashboardFilter) : null
  } catch {
    return null
  }
}

export function setLastFilter(filtro: DashboardFilter): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(LAST_FILTER_KEY, JSON.stringify(filtro))
}

// Rótulo padrão quando o usuário não nomeia (ex.: "SP · Equipamento", "Brasil · Todos").
export function rotuloFiltro(filtro: DashboardFilter, tipoLabel?: (t: string) => string): string {
  const uf = filtro.uf || 'Brasil'
  const tipo = filtro.tipo ? (tipoLabel ? tipoLabel(filtro.tipo) : filtro.tipo) : 'Todos'
  return `${uf} · ${tipo}`
}
