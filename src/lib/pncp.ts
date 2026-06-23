// src/lib/pncp.ts — VERSÃO FINAL (calibrada com dados reais do /api/debug)
//
// Confirmado via debug em produção:
// - PNCP responde 200 com alto volume (dispensas: 196k/90d, pregões: 97k/90d)
// - ~12% dos itens por página são de saúde
// - formato de data AAAAMMDD e codigoModalidadeContratacao obrigatório (já corrigidos)
//
// Esta versão varre MÚLTIPLAS PÁGINAS por modalidade para acumular volume real
// de saúde, com limite configurável para não estourar tempo de request.

import { PNCPContratacoesResponse, PNCPContratacao, Licitacao } from './types'
import { withTimeout } from './http'
import { isSaude } from './saude-filter'

const PNCP_BASE = process.env.PNCP_BASE_URL ?? 'https://pncp.gov.br/api/consulta/v1'
// Endpoint de detalhe (itens/resultado de uma compra) — base diferente da consulta.
const PNCP_API = process.env.PNCP_API_BASE ?? 'https://pncp.gov.br/api/pncp/v1'

const MODALIDADES_SAUDE = [6, 8, 4, 9] // pregão eletr., dispensa, concorrência eletr., inexigibilidade


function buildHeaders() {
  return { Accept: 'application/json' }
}

export function toPncpDate(d: Date): string {
  return d.toISOString().split('T')[0].replace(/-/g, '')
}

export interface PNCPSearchParams {
  dataInicial?: string
  dataFinal?: string
  uf?: string
  tamanhoPagina?: number
  maxPaginasPorModalidade?: number
}

/**
 * Busca uma página de uma modalidade específica.
 */
async function buscarPagina(
  modalidade: number,
  dataInicial: string,
  dataFinal: string,
  pagina: number,
  tamanhoPagina: number,
  uf?: string
): Promise<PNCPContratacoesResponse> {
  const sp = new URLSearchParams({
    dataInicial,
    dataFinal,
    codigoModalidadeContratacao: String(modalidade),
    pagina: String(pagina),
    // O endpoint de consulta do PNCP rejeita tamanhoPagina > 50 (HTTP 400).
    tamanhoPagina: String(Math.min(tamanhoPagina, 50)),
  })
  if (uf) sp.set('uf', uf)

  const res = await fetch(`${PNCP_BASE}/contratacoes/publicacao?${sp}`, {
    headers: buildHeaders(),
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(15_000), // PNCP às vezes pendura; evita travar a função
  })
  if (!res.ok) throw new Error(`PNCP ${res.status} mod ${modalidade} p${pagina}`)
  return res.json()
}

/**
 * Busca compras de saúde varrendo múltiplas páginas por modalidade.
 * Calibrado: com ~12% de saúde por página, varrer 5 páginas x 4 modalidades
 * x 50 itens = ~1000 itens brutos → ~120 de saúde por consulta de 30 dias.
 */
export async function buscarComprasSaude(params: PNCPSearchParams = {}) {
  const hoje = new Date()
  const inicio = new Date(hoje)
  inicio.setDate(hoje.getDate() - 30)

  const dataInicial = params.dataInicial ?? toPncpDate(inicio)
  const dataFinal = params.dataFinal ?? toPncpDate(hoje)
  const tamanhoPagina = params.tamanhoPagina ?? 50
  const maxPaginas = params.maxPaginasPorModalidade ?? 5

  const todas: PNCPContratacao[] = []
  const erros: string[] = []

  // Varre modalidades em paralelo; páginas em série dentro de cada uma
  await Promise.all(
    MODALIDADES_SAUDE.map(async (mod) => {
      for (let pagina = 1; pagina <= maxPaginas; pagina++) {
        try {
          const resp = await buscarPagina(mod, dataInicial, dataFinal, pagina, tamanhoPagina, params.uf)
          const dados = resp.data ?? []
          todas.push(...dados.filter((c) => isSaudeRelated(c.objetoCompra ?? '')))
          if (dados.length < tamanhoPagina || pagina >= (resp.totalPaginas ?? 1)) break
        } catch (e) {
          erros.push(String(e).substring(0, 120))
          break
        }
      }
    })
  )

  // Dedup
  const vistos = new Set<string>()
  const unicas = todas.filter((c) => {
    if (vistos.has(c.numeroControlePNCP)) return false
    vistos.add(c.numeroControlePNCP)
    return true
  })

  return {
    data: unicas,
    totalRegistros: unicas.length,
    erros: erros.length ? erros : undefined,
  }
}

// Filtro de precisão compartilhado (exclui eventos/obras/combustível/limpeza/etc.
// e exige termo específico de saúde). Mesma lógica do ETL.
export function isSaudeRelated(texto: string): boolean {
  return isSaude(texto)
}

// PNCP exige datas no formato yyyyMMdd (sem hífens).
function toYYYYMMDD(s: string): string {
  return s.replace(/-/g, '')
}

/**
 * Busca uma janela de contratações por modalidade.
 * Usado pela análise de vencedores (slots históricos por bimestre/semestre).
 */
export async function buscarContratacoes(params: {
  dataInicial?: string
  dataFinal?: string
  modalidade?: number
  tamanhoPagina?: number
  uf?: string
  pagina?: number
} = {}): Promise<PNCPContratacoesResponse> {
  const hoje = new Date()
  const inicio = new Date(hoje)
  inicio.setDate(hoje.getDate() - 30)

  const sp = new URLSearchParams({
    dataInicial: params.dataInicial ? toYYYYMMDD(params.dataInicial) : toPncpDate(inicio),
    dataFinal: params.dataFinal ? toYYYYMMDD(params.dataFinal) : toPncpDate(hoje),
    // codigoModalidadeContratacao é obrigatório; default 6 = Pregão Eletrônico
    codigoModalidadeContratacao: String(params.modalidade ?? 6),
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: String(params.tamanhoPagina ?? 50),
  })
  if (params.uf) sp.set('uf', params.uf)

  const res = await withTimeout(
    fetch(`${PNCP_BASE}/contratacoes/publicacao?${sp}`, {
      headers: buildHeaders(),
      next: { revalidate: 900 },
    }),
    18_000,
  )
  if (!res.ok) throw new Error(`PNCP ${res.status} contratações mod ${params.modalidade ?? 6}`)
  return res.json()
}

export interface ItemPNCP {
  numeroItem: number
  descricao: string
  valorUnitarioEstimado: number
  quantidade: number
  unidadeMedida: string
  situacaoCompraItemNome: string
}

/** Itens individuais de uma compra específica. */
export async function buscarItensCompra(
  cnpj: string,
  ano: number,
  sequencial: number,
): Promise<ItemPNCP[]> {
  const res = await fetch(
    `${PNCP_API}/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens?pagina=1&tamanhoPagina=100`,
    { headers: buildHeaders(), next: { revalidate: 3600 } },
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.data ?? []
}

export interface ResultadoCompra {
  niFornecedor: string
  nomeFornecedor: string
  valorTotalHomologado: number
  situacaoCompraItemResultadoNome?: string
}

/** Vencedores (fornecedores) de uma compra específica — alimenta a estratificação de fornecedores. */
export async function buscarResultadoCompra(
  cnpj: string,
  anoCompra: number,
  sequencialCompra: number,
): Promise<ResultadoCompra[]> {
  try {
    const res = await withTimeout(
      fetch(
        `${PNCP_API}/orgaos/${cnpj}/compras/${anoCompra}/${sequencialCompra}/resultado?pagina=1&tamanhoPagina=50`,
        { headers: buildHeaders(), next: { revalidate: 3600 } },
      ),
      5_000,
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.data ?? data ?? []
  } catch {
    return []
  }
}

/**
 * Resultados/homologações recentes (endpoint /contratacoes/proposta).
 */
export async function buscarResultados(params: {
  dataInicial?: string
  dataFinal?: string
  uf?: string
  pagina?: number
  tamanhoPagina?: number
} = {}): Promise<PNCPContratacoesResponse> {
  const hoje = new Date()
  const inicio = new Date(hoje)
  inicio.setDate(hoje.getDate() - 90)

  const sp = new URLSearchParams({
    dataInicial: params.dataInicial ? toYYYYMMDD(params.dataInicial) : toPncpDate(inicio),
    dataFinal: params.dataFinal ? toYYYYMMDD(params.dataFinal) : toPncpDate(hoje),
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: String(params.tamanhoPagina ?? 50),
  })
  if (params.uf) sp.set('uf', params.uf)

  const res = await fetch(`${PNCP_BASE}/contratacoes/proposta?${sp}`, {
    headers: buildHeaders(),
    next: { revalidate: 1800 },
  })
  if (!res.ok) {
    return { data: [], totalRegistros: 0, totalPaginas: 0, paginaAtual: 1, tamanhoPagina: 50 }
  }
  return res.json()
}

/**
 * Agrega vencedores de saúde a partir dos resultados recentes (consolidado por órgão).
 */
export async function buscarVencedoresSaude(uf?: string) {
  const resultados = await buscarResultados({ uf, tamanhoPagina: 200 })

  const vencedores: Record<string, { nome: string; vitorias: number; valorTotal: number }> = {}
  for (const item of resultados.data) {
    if (!isSaudeRelated(item.objetoCompra)) continue
    if (!item.valorTotalHomologado) continue
    const key = item.orgaoEntidade.cnpj
    vencedores[key] = {
      nome: item.orgaoEntidade.razaoSocial,
      vitorias: (vencedores[key]?.vitorias ?? 0) + 1,
      valorTotal: (vencedores[key]?.valorTotal ?? 0) + (item.valorTotalHomologado ?? 0),
    }
  }
  return vencedores
}

export function normalizarLicitacao(raw: PNCPContratacao): Licitacao {
  return {
    id: raw.numeroControlePNCP,
    numeroControlePNCP: raw.numeroControlePNCP,
    orgaoEntidade: {
      cnpj: raw.orgaoEntidade?.cnpj ?? '',
      razaoSocial: raw.orgaoEntidade?.razaoSocial ?? '',
      municipio: raw.unidadeOrgao?.municipioNome,
      uf: raw.unidadeOrgao?.ufSigla,
    },
    modalidadeNome: raw.modalidadeNome,
    objetoCompra: raw.objetoCompra,
    valorTotalEstimado: raw.valorTotalEstimado ?? 0,
    dataPublicacaoPncp: raw.dataPublicacaoPncp,
    dataEncerramentoProposta: raw.dataEncerramentoProposta,
    situacaoCompraId: raw.situacaoCompraId,
    situacaoCompraNome: raw.situacaoCompraNome,
    linkSistemaOrigem: raw.linkSistemaOrigem,
  }
}
