// src/lib/contratos.ts
// Cliente do Contratos.gov.br (Comprasnet Contratos) — API pública, sem auth.
// Base verificada (2026-06): https://contratos.comprasnet.gov.br/api
// Endpoints de consulta:
//   GET /contrato/ug/{codigoUG}        → contratos de uma unidade gestora
//   GET /contrato/fornecedor/{cnpj}    → contratos de um fornecedor (incumbente)
// Resposta: array de contratos. Valores vêm como string BR ("75.865.370,30").
// Uso comercial: radar de vencimento de contratos (re-licitação) + incumbente + valores.

import type { ContratoGov } from './types'
import { withTimeout } from './http'

const BASE = 'https://contratos.comprasnet.gov.br/api'
const TIMEOUT = 15_000

/** Converte valor monetário em formato BR ("75.865.370,30") ou número para Number. */
export function parseValorBR(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string' || !v) return 0
  const limpo = v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : 0
}

interface RawContrato {
  id?: number | string
  numero?: string
  objeto?: string
  situacao?: string
  receita_despesa?: string
  modalidade?: string
  vigencia_inicio?: string
  vigencia_fim?: string
  data_assinatura?: string
  valor_inicial?: string | number
  valor_global?: string | number
  valor_acumulado?: string | number
  fornecedor?: { tipo?: string; cnpj_cpf_idgener?: string; nome?: string }
  contratante?: {
    orgao?: { codigo?: string; nome?: string; unidade_gestora?: { codigo?: string; nome?: string; nome_resumido?: string } }
    orgao_origem?: { codigo?: string; nome?: string }
  }
  links?: { historico?: string }
}

function normalizar(raw: RawContrato): ContratoGov {
  const orgao = raw.contratante?.orgao
  const ug = orgao?.unidade_gestora
  return {
    id: String(raw.id ?? raw.numero ?? Math.random().toString(36).slice(2)),
    numero: raw.numero ?? '',
    objeto: raw.objeto ?? '',
    situacao: raw.situacao ?? '',
    receitaDespesa: raw.receita_despesa,
    fornecedorNome: raw.fornecedor?.nome ?? '',
    fornecedorCnpj: raw.fornecedor?.cnpj_cpf_idgener ?? '',
    orgaoNome: orgao?.nome ?? raw.contratante?.orgao_origem?.nome ?? '',
    ugNome: ug?.nome ?? ug?.nome_resumido ?? '',
    ugCodigo: ug?.codigo ?? '',
    modalidade: raw.modalidade ?? '',
    vigenciaInicio: raw.vigencia_inicio ?? '',
    vigenciaFim: raw.vigencia_fim ?? '',
    dataAssinatura: raw.data_assinatura ?? '',
    valorInicial: parseValorBR(raw.valor_inicial),
    valorGlobal: parseValorBR(raw.valor_global),
    valorAcumulado: parseValorBR(raw.valor_acumulado),
    linkHistorico: raw.links?.historico,
  }
}

async function fetchContratos(path: string): Promise<ContratoGov[]> {
  const res = await withTimeout(
    fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } }),
    TIMEOUT,
    'contratos.gov',
  )
  if (!res.ok) throw new Error(`Contratos.gov HTTP ${res.status}`)
  const json = await res.json()
  const arr: RawContrato[] = Array.isArray(json) ? json : (json?.data ?? [])
  return arr.map(normalizar)
}

/** Contratos de uma Unidade Gestora (código SIAFI). */
export function buscarContratosPorUG(codigoUG: string): Promise<ContratoGov[]> {
  return fetchContratos(`/contrato/ug/${encodeURIComponent(codigoUG)}`)
}

/** Contratos de um fornecedor (CNPJ, somente dígitos) — inteligência de incumbente. */
export function buscarContratosPorFornecedor(cnpj: string): Promise<ContratoGov[]> {
  const limpo = cnpj.replace(/\D/g, '')
  return fetchContratos(`/contrato/fornecedor/${limpo}`)
}

// ── Helpers de inteligência ─────────────────────────────────────────────────

/** Contrato vigente = data fim no futuro e situação não inativa. */
export function estaVigente(c: ContratoGov, ref = new Date()): boolean {
  if (!c.vigenciaFim) return false
  const fim = new Date(c.vigenciaFim)
  if (isNaN(fim.getTime())) return false
  const inativo = /inativ|encerrad|rescindid/i.test(c.situacao)
  return fim >= ref && !inativo
}

export interface ContratosStats {
  total: number
  vigentes: number
  valorVigente: number
  vencendo180d: number
}

export function calcularContratosStats(contratos: ContratoGov[]): ContratosStats {
  const hoje = new Date()
  const limite = new Date(hoje.getTime() + 180 * 86_400_000)
  const vigentes = contratos.filter((c) => estaVigente(c, hoje))
  return {
    total: contratos.length,
    vigentes: vigentes.length,
    valorVigente: vigentes.reduce((s, c) => s + c.valorGlobal, 0),
    vencendo180d: vigentes.filter((c) => new Date(c.vigenciaFim) <= limite).length,
  }
}

/** Agrupa por fornecedor (incumbentes) com total contratado. */
export function agruparPorFornecedor(contratos: ContratoGov[]): { nome: string; cnpj: string; contratos: number; valor: number }[] {
  const map = new Map<string, { nome: string; cnpj: string; contratos: number; valor: number }>()
  for (const c of contratos) {
    const k = c.fornecedorCnpj || c.fornecedorNome
    if (!k) continue
    const cur = map.get(k) ?? { nome: c.fornecedorNome, cnpj: c.fornecedorCnpj, contratos: 0, valor: 0 }
    cur.contratos += 1
    cur.valor += c.valorGlobal
    map.set(k, cur)
  }
  return [...map.values()].sort((a, b) => b.valor - a.valor)
}
