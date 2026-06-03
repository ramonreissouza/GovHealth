// src/lib/crm.ts
// CRM Pipeline — persistência em localStorage (client-side only)

export type PipelineStage =
  | 'prospeccao'
  | 'contato'
  | 'proposta'
  | 'negociacao'
  | 'ganho'
  | 'perdido'

export const STAGES: {
  id: PipelineStage
  label: string
  colorClass: string        // badge background + text
  borderClass: string       // column left-border accent
  dropClass: string         // drop-zone highlight
}[] = [
  {
    id: 'prospeccao',
    label: 'Prospecção',
    colorClass: 'bg-brand-blue/15 text-brand-blue border border-brand-blue/30',
    borderClass: 'border-t-brand-blue',
    dropClass: 'bg-brand-blue/5 border-brand-blue/40',
  },
  {
    id: 'contato',
    label: 'Contato',
    colorClass: 'bg-amber/15 text-amber border border-amber/30',
    borderClass: 'border-t-amber',
    dropClass: 'bg-amber/5 border-amber/40',
  },
  {
    id: 'proposta',
    label: 'Proposta',
    colorClass: 'bg-purple/15 text-brand-purple border border-purple/30',
    borderClass: 'border-t-brand-purple',
    dropClass: 'bg-purple/5 border-purple/40',
  },
  {
    id: 'negociacao',
    label: 'Negociação',
    colorClass: 'bg-orange-400/15 text-orange-400 border border-orange-400/30',
    borderClass: 'border-t-orange-400',
    dropClass: 'bg-orange-400/5 border-orange-400/40',
  },
  {
    id: 'ganho',
    label: 'Ganho',
    colorClass: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    borderClass: 'border-t-emerald-500',
    dropClass: 'bg-emerald-500/5 border-emerald-500/40',
  },
  {
    id: 'perdido',
    label: 'Perdido',
    colorClass: 'bg-red/15 text-red border border-red/30',
    borderClass: 'border-t-red',
    dropClass: 'bg-red/5 border-red/40',
  },
]

export interface PipelineDeal {
  id: string
  oportunidadeId?: string        // link to Oportunidade
  titulo: string                 // short title for the card
  hospital: string
  municipio: string
  uf: string
  descricao: string
  valorEstimado: number
  score: number
  categoria: string
  stage: PipelineStage
  responsavel?: string           // sales rep name
  contato?: string               // buyer contact name
  contatoEmail?: string
  contatoTelefone?: string
  prazo?: string                 // ISO date — expected close
  probabilidade: number          // 0-100 %
  notas?: string
  licitacaoLink?: string
  createdAt: string
  updatedAt: string
  movedAt: string                // last time stage changed
}

const STORAGE_KEY = 'govhealth:crm:deals'

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function getDeals(): PipelineDeal[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PipelineDeal[]) : []
  } catch {
    return []
  }
}

function saveDeals(deals: PipelineDeal[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals))
}

export function createDeal(
  data: Omit<PipelineDeal, 'id' | 'createdAt' | 'updatedAt' | 'movedAt'>
): PipelineDeal {
  const now = new Date().toISOString()
  const deal: PipelineDeal = {
    ...data,
    id: `deal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    movedAt: now,
  }
  const deals = getDeals()
  deals.unshift(deal)        // newest first
  saveDeals(deals)
  return deal
}

export function updateDeal(id: string, updates: Partial<PipelineDeal>): PipelineDeal | null {
  const deals = getDeals()
  const idx = deals.findIndex((d) => d.id === id)
  if (idx === -1) return null
  const now = new Date().toISOString()
  const stageChanged = updates.stage !== undefined && updates.stage !== deals[idx].stage
  deals[idx] = {
    ...deals[idx],
    ...updates,
    updatedAt: now,
    movedAt: stageChanged ? now : deals[idx].movedAt,
  }
  saveDeals(deals)
  return deals[idx]
}

export function deleteDeal(id: string): void {
  saveDeals(getDeals().filter((d) => d.id !== id))
}

export function dealExists(oportunidadeId: string): boolean {
  return getDeals().some((d) => d.oportunidadeId === oportunidadeId)
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface CRMStats {
  total: number
  valorTotal: number
  valorGanho: number
  ganhos: number
  perdidos: number
  taxaConversao: number
  porStage: Record<PipelineStage, { count: number; valor: number }>
}

export function calcularCRMStats(deals?: PipelineDeal[]): CRMStats {
  const all = deals ?? getDeals()

  const porStage = Object.fromEntries(
    STAGES.map((s) => [s.id, { count: 0, valor: 0 }])
  ) as Record<PipelineStage, { count: number; valor: number }>

  for (const d of all) {
    if (porStage[d.stage]) {
      porStage[d.stage].count++
      porStage[d.stage].valor += d.valorEstimado
    }
  }

  const ganhos   = porStage.ganho.count
  const perdidos = porStage.perdido.count
  const fechados = ganhos + perdidos

  return {
    total: all.length,
    valorTotal: all.filter((d) => d.stage !== 'perdido').reduce((s, d) => s + d.valorEstimado, 0),
    valorGanho: porStage.ganho.valor,
    ganhos,
    perdidos,
    taxaConversao: fechados > 0 ? Math.round((ganhos / fechados) * 100) : 0,
    porStage,
  }
}

// ── Dias desde o último movimento ─────────────────────────────────────────────

export function diasNoStage(deal: PipelineDeal): number {
  return Math.floor(
    (Date.now() - new Date(deal.movedAt).getTime()) / 86_400_000
  )
}
