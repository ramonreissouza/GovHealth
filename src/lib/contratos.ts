// src/lib/contratos.ts
// Radar de contratos públicos — duas fontes complementares:
//   • Por Unidade Gestora (SIAFI): Contratos.gov.br (Comprasnet Contratos), API pública.
//       GET /contrato/ug/{codigoUG}
//   • Por Fornecedor (CNPJ): PNCP. O endpoint /contrato/fornecedor/{cnpj} do
//       Comprasnet foi descontinuado (passou a exigir login do próprio fornecedor,
//       retornando 404/401 na consulta pública). O PNCP indexa contratos de todas
//       as esferas (federal/estadual/municipal) e permite busca por CNPJ do
//       fornecedor via a API de busca — cobertura maior que a antiga.
// Uso comercial: radar de vencimento de contratos (re-licitação) + incumbente + valores.

import type { ContratoGov } from './types'
import { withTimeout, sleep } from './http'

const BASE = 'https://contratos.comprasnet.gov.br/api'
const PNCP_SEARCH = 'https://pncp.gov.br/api/search'
const PNCP_API = 'https://pncp.gov.br/api/pncp/v1'
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

// ── Fornecedor (CNPJ) via PNCP ────────────────────────────────────────────────

interface PncpContratoSearch {
  title?: string
  description?: string
  item_url?: string
  numero_controle_pncp?: string
  ano?: string
  numero_sequencial?: string
  orgao_cnpj?: string
  orgao_nome?: string
  unidade_nome?: string
  unidade_codigo?: string
  modalidade_licitacao_nome?: string
  tipo_contrato_nome?: string
  situacao_nome?: string
  data_assinatura?: string
  data_inicio_vigencia?: string
  data_fim_vigencia?: string
  valor_global?: number
  cancelado?: boolean
}

function mapPncpContrato(it: PncpContratoSearch, cnpjFornecedor: string, nomeFornecedor: string): ContratoGov {
  const numero = (it.title ?? '').replace(/^contrato\s+n[ºo°.]?\s*/i, '').trim()
  return {
    id: it.numero_controle_pncp ?? `${it.orgao_cnpj ?? ''}-${it.ano ?? ''}-${it.numero_sequencial ?? ''}`,
    numero: numero || it.numero_controle_pncp || '',
    objeto: it.description ?? '',
    situacao: it.cancelado ? 'Cancelado' : (it.situacao_nome ?? ''),
    receitaDespesa: 'Despesa',
    fornecedorNome: nomeFornecedor,
    fornecedorCnpj: cnpjFornecedor,
    orgaoNome: it.orgao_nome ?? '',
    ugNome: it.unidade_nome ?? '',
    ugCodigo: it.unidade_codigo ?? '',
    modalidade: it.modalidade_licitacao_nome || it.tipo_contrato_nome || '',
    vigenciaInicio: (it.data_inicio_vigencia ?? '').substring(0, 10),
    vigenciaFim: (it.data_fim_vigencia ?? '').substring(0, 10),
    dataAssinatura: (it.data_assinatura ?? '').substring(0, 10),
    valorInicial: it.valor_global ?? 0,
    valorGlobal: it.valor_global ?? 0,
    valorAcumulado: it.valor_global ?? 0,
    linkHistorico: it.item_url ? `https://pncp.gov.br${it.item_url}` : undefined,
  }
}

/** Razão social do fornecedor (via detalhe de um contrato) — enriquece a exibição. */
async function nomeFornecedorPNCP(it: PncpContratoSearch): Promise<string> {
  if (!it.orgao_cnpj || !it.ano || !it.numero_sequencial) return ''
  try {
    const url = `${PNCP_API}/orgaos/${it.orgao_cnpj}/contratos/${it.ano}/${Number(it.numero_sequencial)}`
    const res = await withTimeout(fetch(url, { headers: { Accept: 'application/json' } }), TIMEOUT, 'pncp-contrato')
    if (!res.ok) return ''
    const json = await res.json()
    return typeof json?.nomeRazaoSocialFornecedor === 'string' ? json.nomeRazaoSocialFornecedor : ''
  } catch {
    return ''
  }
}

// O PNCP às vezes responde 5xx/instável sob carga. Uma página do resultado com
// uma tentativa extra — UA de navegador (o PNCP bloqueia alguns UAs "de robô").
async function buscarPaginaPNCP(cnpj: string, pagina: number, tam: number): Promise<PncpContratoSearch[] | null> {
  const url = `${PNCP_SEARCH}/?q=${cnpj}&tipos_documento=contrato&ordenacao=-data&pagina=${pagina}&tam_pagina=${tam}`
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const res = await withTimeout(
        fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; GovHealthAI/1.0)' } }),
        TIMEOUT,
        'pncp-search',
      )
      if (res.ok) {
        const json = await res.json()
        return Array.isArray(json?.items) ? json.items : []
      }
    } catch {
      /* rede/timeout — tenta de novo abaixo */
    }
    await sleep(600)
  }
  return null   // falhou após as tentativas
}

/** Contratos de um fornecedor (CNPJ, somente dígitos) — inteligência de incumbente. */
export async function buscarContratosPorFornecedor(cnpj: string): Promise<ContratoGov[]> {
  const limpo = cnpj.replace(/\D/g, '')
  if (limpo.length !== 14) throw new Error('CNPJ inválido (informe 14 dígitos).')

  const TAM = 50
  const MAX_PAGINAS = 4        // até ~200 contratos — suficiente para o radar
  const itens: PncpContratoSearch[] = []

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const lote = await buscarPaginaPNCP(limpo, pagina, TAM)
    // A 1ª página falhar é erro real (avisa o usuário). Páginas seguintes falharem
    // não descartam o que já veio — devolvemos o que temos (resultado parcial).
    if (lote === null) {
      if (pagina === 1) throw new Error('PNCP indisponível no momento. Tente novamente em instantes.')
      break
    }
    itens.push(...lote)
    if (lote.length < TAM) break        // última página
  }

  if (itens.length === 0) return []

  // Uma chamada de detalhe para obter a razão social (a mesma para todos os contratos do CNPJ).
  const nome = await nomeFornecedorPNCP(itens[0])
  return itens.map((it) => mapPncpContrato(it, limpo, nome))
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
