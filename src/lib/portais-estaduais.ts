// src/lib/portais-estaduais.ts
// Portais Estaduais de Compras — SP, RJ, MG, BA
//
// Estratégia por estado:
//   SP — BEC/SP tem web service SOAP; usamos PNCP + tentativa BEC
//   MG — LicitaMG sem API pública; usamos PNCP
//   RJ — SUBG-RJ sem API pública; usamos PNCP
//   BA — Portal BA sem API pública; usamos PNCP
//
// Em todos os casos, o PNCP (já integrado) é a fonte primária e mais confiável.
// Os adapters estaduais complementam com dados de portais próprios onde disponível.

import {
  buscarComprasSaude,
  buscarLicitacoesAbertas,
  normalizarLicitacao,
  isSaudeRelated,
  type PNCPSearchParams,
} from './pncp'
import { inferirCategoria } from './score-engine'
import type { PNCPContratacao } from './types'

// ── Configuração dos portais ──────────────────────────────────────────────────
// O PNCP (Lei 14.133) é o agregador nacional obrigatório: TODOS os 27 entes
// federativos publicam suas licitações lá. Por isso cobrimos as 27 UFs filtrando
// o PNCP por estado. Onde o estado tem portal próprio conhecido, registramos o
// deep-link; SP ainda tenta um adapter complementar (BEC/SP).

export type UFEstadual =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA'
  | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI' | 'RJ' | 'RN'
  | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO'

export const TODAS_UFS: UFEstadual[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

const NOME_ESTADO: Record<UFEstadual, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
}

export interface PortalConfig {
  uf: UFEstadual
  nomeEstado: string
  nomePortal: string
  urlPortal: string
  urlConsulta: string          // deep-link para busca pública de licitações
  temAPIPublica: boolean
  notaIntegracao: string
}

// Overrides para estados com portal próprio conhecido.
const PORTAL_OVERRIDES: Partial<Record<UFEstadual, Partial<PortalConfig>>> = {
  SP: {
    nomePortal: 'BEC/SP',
    urlPortal: 'https://www.bec.sp.gov.br',
    urlConsulta: 'https://www.bec.sp.gov.br/BECSP/OC_ConsultarLicitacoes.aspx',
    temAPIPublica: true,   // SOAP/XML — ver buscarBECSP()
    notaIntegracao: 'PNCP + BEC/SP (tentativa SOAP)',
  },
  MG: {
    nomePortal: 'LicitaMG',
    urlPortal: 'https://www.compras.mg.gov.br',
    urlConsulta: 'https://www.compras.mg.gov.br/compras/search',
  },
  RJ: {
    nomePortal: 'SIGA-RJ',
    urlPortal: 'https://www.compras.rj.gov.br',
    urlConsulta: 'https://www.compras.rj.gov.br',
  },
  BA: {
    nomePortal: 'Compras.BA',
    urlPortal: 'https://www.licitacoes.ba.gov.br',
    urlConsulta: 'https://www.licitacoes.ba.gov.br/categoria/saude',
  },
  PR: { nomePortal: 'Compras Paraná', urlPortal: 'https://www.comprasparana.pr.gov.br', urlConsulta: 'https://www.comprasparana.pr.gov.br' },
  RS: { nomePortal: 'Compras RS', urlPortal: 'https://compras.rs.gov.br', urlConsulta: 'https://compras.rs.gov.br' },
  SC: { nomePortal: 'Portal SC', urlPortal: 'https://www.portaldecompras.sc.gov.br', urlConsulta: 'https://www.portaldecompras.sc.gov.br' },
  ES: { nomePortal: 'Compras ES', urlPortal: 'https://compras.es.gov.br', urlConsulta: 'https://compras.es.gov.br' },
  GO: { nomePortal: 'ComprasNet GO', urlPortal: 'https://www.comprasnet.go.gov.br', urlConsulta: 'https://www.comprasnet.go.gov.br' },
  CE: { nomePortal: 'Licitações CE', urlPortal: 'https://www.portalcompras.ce.gov.br', urlConsulta: 'https://www.portalcompras.ce.gov.br' },
  PE: { nomePortal: 'Compras PE', urlPortal: 'https://www.peintegrado.pe.gov.br', urlConsulta: 'https://www.peintegrado.pe.gov.br' },
  DF: { nomePortal: 'Compras DF', urlPortal: 'https://www.compras.df.gov.br', urlConsulta: 'https://www.compras.df.gov.br' },
}

function buildPortalConfig(uf: UFEstadual): PortalConfig {
  const ov = PORTAL_OVERRIDES[uf] ?? {}
  return {
    uf,
    nomeEstado: NOME_ESTADO[uf],
    nomePortal: ov.nomePortal ?? `Portal de Compras ${uf}`,
    urlPortal: ov.urlPortal ?? 'https://pncp.gov.br',
    urlConsulta:
      ov.urlConsulta ??
      `https://pncp.gov.br/app/editais?uf=${uf}&pagina=1&q=sa%C3%BAde`,
    temAPIPublica: ov.temAPIPublica ?? false,
    notaIntegracao:
      ov.notaIntegracao ??
      (ov.urlPortal
        ? 'PNCP (fonte primária) + portal estadual próprio'
        : 'PNCP — fonte oficial nacional (Lei 14.133)'),
  }
}

export const PORTAIS_CONFIG: Record<UFEstadual, PortalConfig> = Object.fromEntries(
  TODAS_UFS.map((uf) => [uf, buildPortalConfig(uf)])
) as Record<UFEstadual, PortalConfig>

// ── Entidades-chave de saúde por estado ──────────────────────────────────────
// CNPJs e razões sociais de grandes compradores estaduais de equipamentos médicos

// Entidades-chave conhecidas (estados prioritários). Para os demais, a detecção
// usa um padrão genérico (Secretaria de Saúde / SES-UF) em eEntidadeSaudeEstadual.
export const ENTIDADES_SAUDE: Partial<Record<UFEstadual, string[]>> = {
  SP: [
    'Hospital das Clínicas',
    'HCFMUSP',
    'IAMSPE',
    'Fundação do ABC',
    'Fundação Oncocentro',
    'Santa Casa',
    'Secretaria de Estado da Saúde',
    'SES-SP',
    'HSPE',
    'Instituto do Coração',
    'InCor',
    'UNIFESP',
  ],
  MG: [
    'FHEMIG',
    'Hospital João XXIII',
    'Fundação Hospitalar',
    'IPSEMG',
    'SES-MG',
    'Secretaria de Estado de Saúde',
    'Hospital Risoleta Neves',
    'HCMG',
    'UFMG',
  ],
  RJ: [
    'SMS Rio',
    'Secretaria Municipal de Saúde',
    'SMSDC',
    'Hospital Pedro Ernesto',
    'Hospital Souza Aguiar',
    'HUPE',
    'UERJ',
    'Fiocruz',
    'SES-RJ',
    'Secretaria de Estado de Saúde',
  ],
  BA: [
    'SESAB',
    'Secretaria da Saúde',
    'Hospital Geral do Estado',
    'HGE',
    'UFBA',
    'SMS Salvador',
    'Secretaria Municipal de Saúde',
    'Hospital Ana Nery',
    'BAHIANA',
  ],
}

// ── Adapter SP — BEC/SP ───────────────────────────────────────────────────────
// O BEC/SP expõe um endpoint de consulta pública. Tentamos buscar o JSON;
// em caso de falha (CORS, formato inesperado, timeout) retornamos [] silenciosamente.

async function buscarBECSP(termo?: string): Promise<LicitacaoEstadual[]> {
  // BEC/SP tem um endpoint JSON não documentado oficialmente.
  // Usamos apenas como complemento — falha silenciosamente.
  try {
    const sp = new URLSearchParams({
      ds_objeto: termo ?? 'equipamento médico saúde',
      nr_pagina: '1',
      qt_registros: '50',
    })
    const url = `https://www.bec.sp.gov.br/BECSP_Api/licitacoes?${sp}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const items: unknown[] = Array.isArray(data) ? data : (data?.resultado ?? data?.items ?? [])
    return items.map((raw) => normalizarBECSP(raw as Record<string, unknown>))
  } catch {
    return []
  }
}

function normalizarBECSP(raw: Record<string, unknown>): LicitacaoEstadual {
  return {
    id: String(raw.nr_ocorrencia ?? raw.id ?? Math.random()),
    numeroExterno: String(raw.nr_ocorrencia ?? raw.numero ?? ''),
    proponente: String(raw.no_unidade ?? raw.orgao ?? ''),
    cnpj: String(raw.cd_cnpj ?? raw.cnpj ?? ''),
    municipio: String(raw.no_municipio ?? raw.municipio ?? ''),
    uf: 'SP',
    descricao: String(raw.ds_objeto ?? raw.descricao ?? ''),
    valor: Number(raw.vl_estimado ?? raw.valor ?? 0),
    dataPublicacao: String(raw.dt_publicacao ?? raw.data ?? ''),
    dataEncerramento: raw.dt_encerramento ? String(raw.dt_encerramento) : undefined,
    situacao: String(raw.ds_situacao ?? raw.situacao ?? ''),
    modalidade: String(raw.no_modalidade ?? raw.modalidade ?? ''),
    categoria: inferirCategoria(String(raw.ds_objeto ?? '')),
    link: String(raw.url ?? raw.link ?? `https://www.bec.sp.gov.br/BECSP/OC_ConsultarLicitacoes.aspx?ocorrencia=${raw.nr_ocorrencia ?? ''}`),
    fonte: 'bec-sp',
  }
}

// ── Tipo normalizado cross-portal ─────────────────────────────────────────────

export interface LicitacaoEstadual {
  id: string
  numeroExterno: string        // número no PNCP ou portal próprio
  proponente: string
  cnpj: string
  municipio: string
  uf: string
  descricao: string
  valor: number
  dataPublicacao: string
  dataEncerramento?: string
  situacao: string
  modalidade: string
  categoria: string
  link: string
  fonte: 'pncp' | 'bec-sp' | 'licitamg' | 'subg-rj' | 'compras-ba'
}

// ── Normaliza PNCPContratacao → LicitacaoEstadual ─────────────────────────────

function pncpToEstadual(raw: PNCPContratacao): LicitacaoEstadual {
  const norm = normalizarLicitacao(raw)
  return {
    id: norm.id,
    numeroExterno: norm.numeroControlePNCP,
    proponente: norm.orgaoEntidade.razaoSocial,
    cnpj: norm.orgaoEntidade.cnpj,
    municipio: norm.orgaoEntidade.municipio ?? '',
    uf: norm.orgaoEntidade.uf ?? '',
    descricao: norm.objetoCompra,
    valor: raw.valorTotalEstimado ?? raw.valorTotalHomologado ?? 0,
    dataPublicacao: raw.dataPublicacaoPncp ?? '',
    dataEncerramento: raw.dataEncerramentoProposta,
    situacao: raw.situacaoCompraNome,
    modalidade: raw.modalidadeNome,
    categoria: inferirCategoria(raw.objetoCompra),
    link: raw.linkSistemaOrigem,
    fonte: 'pncp',
  }
}

// ── Verifica se pertence a entidade estadual de saúde ─────────────────────────

export function eEntidadeSaudeEstadual(proponente: string, uf: UFEstadual): boolean {
  const lower = proponente.toLowerCase()
  const conhecidas = ENTIDADES_SAUDE[uf]
  if (conhecidas && conhecidas.some((e) => lower.includes(e.toLowerCase()))) return true
  // Fallback genérico: secretaria estadual de saúde / SES-UF
  return (
    lower.includes(`ses-${uf.toLowerCase()}`) ||
    lower.includes('secretaria de estado de saúde') ||
    lower.includes('secretaria de estado da saúde') ||
    lower.includes('secretaria estadual de saúde')
  )
}

// ── Busca licitações de um estado ────────────────────────────────────────────

export interface ResultadoEstado {
  uf: UFEstadual
  portal: PortalConfig
  licitacoes: LicitacaoEstadual[]
  kpis: KPIsEstado
  fontesAtivas: { pncp: boolean; portalProprio: boolean }
  atualizadoEm: string
}

export interface KPIsEstado {
  total: number
  abertas: number
  valorTotal: number
  ticketMedio: number
  entidadesEstaduais: number
  porCategoria: Record<string, { count: number; valor: number }>
  topProponentes: { proponente: string; cnpj: string; valor: number; count: number }[]
}

export async function buscarLicitacoesEstado(
  uf: UFEstadual,
  params: PNCPSearchParams = {}
): Promise<ResultadoEstado> {
  const portal = PORTAIS_CONFIG[uf]
  const now = new Date()

  // ── PNCP (fonte primária) ──────────────────────────────────────────────────
  let pncpOk = false
  let licitacoes: LicitacaoEstadual[] = []

  try {
    // Recentes publicadas (sobretudo encerradas) + ABERTAS (recebendo proposta).
    const [recentes, abertas] = await Promise.all([
      buscarComprasSaude({ ...params, uf, tamanhoPagina: 50 }),
      buscarLicitacoesAbertas({ uf, tamanhoPagina: 50 }),
    ])
    const brutas = [...abertas, ...recentes.data] // ambos já filtrados por saúde
    const vistos = new Set<string>()
    licitacoes = brutas
      .filter((c) => { if (vistos.has(c.numeroControlePNCP)) return false; vistos.add(c.numeroControlePNCP); return true })
      .map(pncpToEstadual)
    pncpOk = true
  } catch { /* silent */ }

  // ── Portal estadual próprio (complemento) ─────────────────────────────────
  let portalOk = false
  if (uf === 'SP' && portal.temAPIPublica) {
    const extra = await buscarBECSP()
    if (extra.length > 0) {
      // dedup por descrição + valor para evitar duplicatas com PNCP
      const seen = new Set(licitacoes.map((l) => `${l.descricao.slice(0, 40)}:${l.valor}`))
      const novas = extra.filter((e) => !seen.has(`${e.descricao.slice(0, 40)}:${e.valor}`))
      licitacoes.push(...novas)
      portalOk = true
    }
  }

  return {
    uf,
    portal,
    licitacoes: licitacoes.sort((a, b) => new Date(b.dataPublicacao).getTime() - new Date(a.dataPublicacao).getTime()),
    kpis: calcularKpis(licitacoes, uf),
    fontesAtivas: { pncp: pncpOk, portalProprio: portalOk },
    atualizadoEm: now.toISOString(),
  }
}

// ── Cálculo de KPIs de um conjunto de licitações ─────────────────────────────

function calcularKpis(licitacoes: LicitacaoEstadual[], uf: UFEstadual): KPIsEstado {
  const now = new Date()
  const abertas = licitacoes.filter((l) => {
    if (!l.dataEncerramento) return l.situacao.toLowerCase().includes('aberto') || l.situacao.toLowerCase().includes('publicado')
    return new Date(l.dataEncerramento) > now
  }).length

  const valorTotal = licitacoes.reduce((s, l) => s + l.valor, 0)
  const ticketMedio = licitacoes.length ? Math.round(valorTotal / licitacoes.length) : 0
  const entidadesEstaduais = licitacoes.filter((l) => eEntidadeSaudeEstadual(l.proponente, uf)).length

  const porCategoria: Record<string, { count: number; valor: number }> = {}
  for (const l of licitacoes) {
    if (!porCategoria[l.categoria]) porCategoria[l.categoria] = { count: 0, valor: 0 }
    porCategoria[l.categoria].count++
    porCategoria[l.categoria].valor += l.valor
  }

  const pmap: Record<string, { proponente: string; cnpj: string; valor: number; count: number }> = {}
  for (const l of licitacoes) {
    if (!pmap[l.cnpj]) pmap[l.cnpj] = { proponente: l.proponente, cnpj: l.cnpj, valor: 0, count: 0 }
    pmap[l.cnpj].valor += l.valor
    pmap[l.cnpj].count++
  }
  const topProponentes = Object.values(pmap).sort((a, b) => b.valor - a.valor).slice(0, 10)

  return { total: licitacoes.length, abertas, valorTotal, ticketMedio, entidadesEstaduais, porCategoria, topProponentes }
}

function kpisVazio(): KPIsEstado {
  return { total: 0, abertas: 0, valorTotal: 0, ticketMedio: 0, entidadesEstaduais: 0, porCategoria: {}, topProponentes: [] }
}

// ── Resumo paralelo de todos os estados ──────────────────────────────────────

export interface ResumoEstados {
  estados: Partial<Record<UFEstadual, { kpis: KPIsEstado; fontesAtivas: { pncp: boolean; portalProprio: boolean } }>>
  atualizadoEm: string
}

/**
 * Resumo das 27 UFs. Faz UMA varredura nacional do PNCP (sem filtro de UF) e
 * agrupa por estado — muito mais eficiente que 27 buscas paralelas, que
 * estourariam o rate-limit do PNCP.
 */
export async function buscarResumoEstados(): Promise<ResumoEstados> {
  const estados: ResumoEstados['estados'] = {}
  for (const uf of TODAS_UFS) {
    estados[uf] = { kpis: kpisVazio(), fontesAtivas: { pncp: false, portalProprio: false } }
  }

  try {
    const result = await buscarComprasSaude({ tamanhoPagina: 50 })
    const porUf: Partial<Record<UFEstadual, LicitacaoEstadual[]>> = {}
    for (const c of result.data) {
      const lic = pncpToEstadual(c)
      const uf = lic.uf as UFEstadual
      if (!uf || !TODAS_UFS.includes(uf)) continue
      ;(porUf[uf] ??= []).push(lic)
    }
    for (const uf of TODAS_UFS) {
      const lics = porUf[uf] ?? []
      estados[uf] = { kpis: calcularKpis(lics, uf), fontesAtivas: { pncp: true, portalProprio: false } }
    }
  } catch { /* mantém estados zerados */ }

  return { estados, atualizadoEm: new Date().toISOString() }
}
