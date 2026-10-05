// src/lib/crm.ts
// CRM Pipeline — cache local sincronizado com a conta (ver lib/synced).

import { readLocal, writeLocal } from './synced'

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
  // Tarefas por etapa (ver CHECKLIST_ETAPA). Ausente = deal anterior ao checklist,
  // que recebe o modelo padrão na primeira leitura (checklistDoDeal).
  checklist?: TarefaEtapa[]
  createdAt: string
  updatedAt: string
  movedAt: string                // last time stage changed
}

// ── Checklist por etapa ───────────────────────────────────────────────────────
// O que precisa estar feito em cada etapa de uma licitação, do edital ao pagamento.
// O checklist de habilitação (documento por documento) já mora no dossiê do edital
// (lib/edital-workspace.ts); aqui ele aparece como uma tarefa só, com o progresso
// do dossiê ao lado quando o deal veio de uma oportunidade.

export interface TarefaEtapa {
  id: string
  stage: PipelineStage
  label: string
  feito: boolean
  link?: string          // tela do GovHealth que resolve a tarefa
  personalizada?: boolean // criada pelo usuário (fora do modelo)
}

export const ID_TAREFA_HABILITACAO = 'proposta:habilitacao'

export const CHECKLIST_ETAPA: Record<PipelineStage, { id: string; label: string; link?: string }[]> = {
  prospeccao: [
    { id: 'prospeccao:edital',        label: 'Ler o edital e o termo de referência', link: '/edital' },
    { id: 'prospeccao:especificacao', label: 'Conferir se o produto atende à especificação' },
    { id: 'prospeccao:prazos',        label: 'Anotar os prazos de impugnação e de esclarecimento', link: '/agenda' },
    { id: 'prospeccao:decisao',       label: 'Decidir se vale participar' },
  ],
  contato: [
    { id: 'contato:responsavel',      label: 'Identificar quem conduz a compra no órgão' },
    { id: 'contato:esclarecimento',   label: 'Tirar as dúvidas do edital (pedido de esclarecimento)', link: '/edital' },
    { id: 'contato:visita',           label: 'Agendar a visita técnica, se o edital exigir' },
  ],
  proposta: [
    { id: ID_TAREFA_HABILITACAO,      label: 'Documentos de habilitação em dia', link: '/editais' },
    { id: 'proposta:anvisa',          label: 'Registro ANVISA do produto válido', link: '/perfil?tab=portfolio' },
    { id: 'proposta:amostra',         label: 'Amostra ou catálogo, se o edital exigir' },
    { id: 'proposta:planilha',        label: 'Proposta comercial e planilha de preços' },
    { id: 'proposta:portal',          label: 'Proposta cadastrada no portal' },
  ],
  negociacao: [
    { id: 'negociacao:sessao',        label: 'Acompanhar a sessão de lances', link: '/radar' },
    { id: 'negociacao:diligencia',    label: 'Responder diligências e convocações do pregoeiro' },
    { id: 'negociacao:ajustada',      label: 'Enviar a proposta ajustada ao lance final' },
    { id: 'negociacao:recurso',       label: 'Recurso ou contrarrazões, se houver', link: '/edital' },
  ],
  ganho: [
    { id: 'ganho:contrato',           label: 'Assinar o contrato ou a ata' },
    { id: 'ganho:garantia',           label: 'Prestar a garantia contratual, se exigida' },
    { id: 'ganho:empenho',            label: 'Receber a nota de empenho' },
    { id: 'ganho:entrega',            label: 'Entregar e obter o recebimento definitivo' },
    { id: 'ganho:pagamento',          label: 'Emitir a nota fiscal e acompanhar o pagamento' },
  ],
  perdido: [
    { id: 'perdido:motivo',           label: 'Registrar o motivo da perda (preço, habilitação, especificação)' },
    { id: 'perdido:recurso',          label: 'Avaliar se cabe recurso', link: '/edital' },
  ],
}

export function checklistPadrao(): TarefaEtapa[] {
  return STAGES.flatMap((s) =>
    CHECKLIST_ETAPA[s.id].map((t) => ({ ...t, stage: s.id, feito: false })),
  )
}

/** O checklist do deal; deals antigos (sem o campo) recebem o modelo padrão. */
export function checklistDoDeal(deal: Pick<PipelineDeal, 'checklist'>): TarefaEtapa[] {
  return deal.checklist ?? checklistPadrao()
}

export function tarefasDaEtapa(deal: Pick<PipelineDeal, 'checklist'>, stage: PipelineStage): TarefaEtapa[] {
  return checklistDoDeal(deal).filter((t) => t.stage === stage)
}

export function progressoEtapa(
  deal: Pick<PipelineDeal, 'checklist'>,
  stage: PipelineStage,
): { feitos: number; total: number } {
  const ts = tarefasDaEtapa(deal, stage)
  return { feitos: ts.filter((t) => t.feito).length, total: ts.length }
}

/**
 * Tarefas que ficaram para trás: não feitas, de etapas ANTERIORES à atual no funil.
 * "Perdido" não é etapa do caminho (ninguém passa por ela), então não deixa pendência,
 * e um deal perdido não cobra as tarefas de quem ganhou.
 */
export function pendentesAnteriores(deal: Pick<PipelineDeal, 'checklist' | 'stage'>): TarefaEtapa[] {
  if (deal.stage === 'perdido') return []
  const ordem: PipelineStage[] = STAGES.map((s) => s.id).filter((id) => id !== 'perdido')
  const atual = ordem.indexOf(deal.stage)
  const anteriores = new Set(ordem.slice(0, atual))
  return checklistDoDeal(deal).filter((t) => anteriores.has(t.stage) && !t.feito)
}

export function alternarTarefa(checklist: TarefaEtapa[], id: string): TarefaEtapa[] {
  return checklist.map((t) => (t.id === id ? { ...t, feito: !t.feito } : t))
}

export function adicionarTarefa(checklist: TarefaEtapa[], stage: PipelineStage, label: string): TarefaEtapa[] {
  const texto = label.trim()
  if (!texto) return checklist
  const id = `${stage}:x-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return [...checklist, { id, stage, label: texto, feito: false, personalizada: true }]
}

export function removerTarefa(checklist: TarefaEtapa[], id: string): TarefaEtapa[] {
  return checklist.filter((t) => t.id !== id)
}

const STORAGE_KEY = 'govhealth:crm:deals'

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function getDeals(): PipelineDeal[] {
  return readLocal<PipelineDeal[]>(STORAGE_KEY, [])
}

function saveDeals(deals: PipelineDeal[]): void {
  writeLocal(STORAGE_KEY, deals)
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
