// src/lib/edital-workspace.ts
// "Workspace do Edital" (dossiê) — organiza a participação numa licitação:
// checklist de habilitação (Lei 14.133), prazos do certame, registro de
// documentos e notas. Persistência em localStorage, padrão de crm.ts/portfolio.ts.
// Não armazena binários: cada documento é um item com status + link opcional
// (ex.: URL do arquivo no Drive) — um registro de documentos, não um cofre.

import type { Oportunidade } from './types'

const STORAGE_KEY = 'govhealth:editais'

export type WorkspaceStatus =
  | 'analise'      // Em análise
  | 'preparando'   // Preparando proposta
  | 'enviado'      // Proposta enviada
  | 'ganho'
  | 'perdido'
  | 'descartado'

export const WORKSPACE_STATUS: { id: WorkspaceStatus; label: string; cor: string }[] = [
  { id: 'analise',    label: 'Em análise',          cor: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30' },
  { id: 'preparando', label: 'Preparando proposta', cor: 'bg-amber/15 text-amber border-amber/30' },
  { id: 'enviado',    label: 'Proposta enviada',    cor: 'bg-purple/15 text-brand-purple border-purple/30' },
  { id: 'ganho',      label: 'Ganho',               cor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { id: 'perdido',    label: 'Perdido',             cor: 'bg-red/15 text-red border-red/30' },
  { id: 'descartado', label: 'Descartado',          cor: 'bg-bg4 text-faint border-subtle2' },
]

export interface ChecklistItem {
  id: string
  label: string
  grupo: string          // ex.: "Habilitação jurídica"
  feito: boolean
  obrigatorio: boolean
  link?: string          // URL onde o documento está (Drive, etc.)
  observacao?: string
}

export interface PrazoItem {
  id: string
  rotulo: string
  data?: string          // ISO (input date)
  feito: boolean
}

export interface EditalWorkspace {
  id: string                       // = Oportunidade.id (1 dossiê por oportunidade)
  titulo: string
  orgao?: string
  municipio?: string
  uf?: string
  valorEstimado?: number
  numeroControlePNCP?: string
  linkEdital?: string
  status: WorkspaceStatus
  checklist: ChecklistItem[]
  prazos: PrazoItem[]
  notas: string
  criadoEm: string
  atualizadoEm: string
}

// ── Templates padrão (Lei 14.133/2021) ──────────────────────────────────────────

function genId(prefix = 'i'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

const CHECKLIST_TEMPLATE: { grupo: string; label: string; obrigatorio: boolean }[] = [
  { grupo: 'Habilitação jurídica',        label: 'Ato constitutivo / contrato social', obrigatorio: true },
  { grupo: 'Habilitação jurídica',        label: 'CNPJ ativo',                          obrigatorio: true },
  { grupo: 'Regularidade fiscal/trabalhista', label: 'Certidão Conjunta RFB/PGFN (federal)', obrigatorio: true },
  { grupo: 'Regularidade fiscal/trabalhista', label: 'Certificado de Regularidade do FGTS (CRF)', obrigatorio: true },
  { grupo: 'Regularidade fiscal/trabalhista', label: 'CNDT (débitos trabalhistas)',     obrigatorio: true },
  { grupo: 'Regularidade fiscal/trabalhista', label: 'Certidão estadual',               obrigatorio: true },
  { grupo: 'Regularidade fiscal/trabalhista', label: 'Certidão municipal',              obrigatorio: true },
  { grupo: 'Qualificação econômico-financeira', label: 'Balanço patrimonial / DRE',     obrigatorio: true },
  { grupo: 'Qualificação econômico-financeira', label: 'Certidão negativa de falência/recuperação', obrigatorio: true },
  { grupo: 'Qualificação técnica',        label: 'Atestado(s) de capacidade técnica',   obrigatorio: true },
  { grupo: 'Qualificação técnica',        label: 'Registro/Autorização ANVISA do produto', obrigatorio: false },
  { grupo: 'Declarações e proposta',      label: 'Declaração ME/EPP (se aplicável)',    obrigatorio: false },
  { grupo: 'Declarações e proposta',      label: 'Declaração de cumprimento do edital', obrigatorio: true },
  { grupo: 'Declarações e proposta',      label: 'Proposta comercial + planilha de preços', obrigatorio: true },
]

const PRAZOS_TEMPLATE: string[] = [
  'Limite para impugnação/esclarecimentos',
  'Abertura da sessão / disputa',
  'Envio de proposta e documentos',
  'Prazo recursal',
  'Prazo de entrega/fornecimento',
]

function checklistPadrao(): ChecklistItem[] {
  return CHECKLIST_TEMPLATE.map((t) => ({ id: genId('c'), feito: false, ...t }))
}

function prazosPadrao(): PrazoItem[] {
  return PRAZOS_TEMPLATE.map((rotulo) => ({ id: genId('p'), rotulo, feito: false }))
}

// ── Persistência ──────────────────────────────────────────────────────────────

export function getWorkspaces(): EditalWorkspace[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveAll(ws: EditalWorkspace[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ws))
}

export function getWorkspace(id: string): EditalWorkspace | null {
  return getWorkspaces().find((w) => w.id === id) ?? null
}

export function workspaceExists(id: string): boolean {
  return getWorkspaces().some((w) => w.id === id)
}

/** Cria o dossiê a partir de uma oportunidade (idempotente: não duplica). */
export function criarDeOportunidade(opp: Oportunidade): EditalWorkspace {
  const existente = getWorkspace(opp.id)
  if (existente) return existente

  const lic = opp.licitacaoRelacionada
  const now = new Date().toISOString()
  const ws: EditalWorkspace = {
    id: opp.id,
    titulo: opp.descricao.slice(0, 80),
    orgao: opp.hospital ?? lic?.orgaoEntidade?.razaoSocial,
    municipio: opp.municipio,
    uf: opp.uf,
    valorEstimado: opp.valorEstimado,
    numeroControlePNCP: lic?.numeroControlePNCP,
    linkEdital: lic?.linkSistemaOrigem,
    status: 'analise',
    checklist: checklistPadrao(),
    prazos: prazosPadrao(),
    notas: '',
    criadoEm: now,
    atualizadoEm: now,
  }
  saveAll([ws, ...getWorkspaces()])
  return ws
}

export function updateWorkspace(id: string, patch: Partial<EditalWorkspace>): void {
  saveAll(getWorkspaces().map((w) =>
    w.id === id ? { ...w, ...patch, id: w.id, atualizadoEm: new Date().toISOString() } : w,
  ))
}

export function deleteWorkspace(id: string): void {
  saveAll(getWorkspaces().filter((w) => w.id !== id))
}

// ── Progresso ────────────────────────────────────────────────────────────────

export interface WorkspaceProgresso {
  totalDocs: number
  feitosDocs: number
  obrigatoriosPendentes: number
  pctDocs: number
  proximoPrazo: PrazoItem | null
}

export function calcularProgresso(w: EditalWorkspace): WorkspaceProgresso {
  const totalDocs = w.checklist.length
  const feitosDocs = w.checklist.filter((c) => c.feito).length
  const obrigatoriosPendentes = w.checklist.filter((c) => c.obrigatorio && !c.feito).length

  const futuros = w.prazos
    .filter((p) => !p.feito && p.data)
    .sort((a, b) => new Date(a.data!).getTime() - new Date(b.data!).getTime())

  return {
    totalDocs,
    feitosDocs,
    obrigatoriosPendentes,
    pctDocs: totalDocs ? Math.round((feitosDocs / totalDocs) * 100) : 0,
    proximoPrazo: futuros[0] ?? null,
  }
}
