// src/lib/pncp.ts
// Portal Nacional de Contrata��es P�blicas � API p�blica, sem autentica��o

import { PNCPContratacoesResponse, PNCPContratacao, Licitacao } from './types'
import { withTimeout } from './http'
import { stripAccents } from './text'

const PNCP_BASE = process.env.PNCP_BASE_URL ?? 'https://pncp.gov.br/api/consulta/v1'
const PNCP_API = process.env.PNCP_API_BASE ?? 'https://pncp.gov.br/api/pncp/v1'

// Palavras-chave para filtrar compras de sa�de
const HEALTH_KEYWORDS = [
  'tom�grafo', 'tomografia', 'resson�ncia', 'ultrassom', 'ultrassonografia',
  'raio-x', 'radiologia', 'mam�grafo', 'mamografia', 'endosc�pio',
  'ventilador', 'respirador', 'monitor multiparam�trico', 'desfibrilador',
  'eletrocardi�grafo', 'ox�metro', 'bomba de infus�o',
  'analisador hematol�gico', 'autoclave', 'mesa cir�rgica',
  'equipamento hospitalar', 'equipamento m�dico', 'material m�dico',
  'hospital', 'sa�de', 'unidade de terapia', 'laborat�rio cl�nico',
  'hemoterapia', 'hemodi�lise', 'oncologia',
  // Medicamentos / insumos farmac�uticos
  'medicament', 'f�rmaco', 'farmac�ut', 'antibi�tic', 'insumo farmac',
  'princ�pio ativo', 'vacina', 'soro fisiol�gico', 'injet�vel',
  // OPME
  '�rtese', 'pr�tese', 'implante', 'stent', 'marcapasso', 'osteoss�ntese',
  // Acess�rios / insumos / servi�os de sa�de
  'material hospitalar', 'cateter', 'sonda', 'seringa', 'gaze', 'curativo',
  'ambul�ncia', 'oxig�nio medicinal', 'gases medicinais', 'esteriliza��o',
  'lavanderia hospitalar', 'res�duo de servi�o de sa�de', 'sus',
]

// Termos que indicam compra N�O relacionada � sa�de � sobrescrevem um match
// gen�rico (ex.: "trator para a Secretaria de Sa�de" deve ser exclu�do).
const NAO_SAUDE_KEYWORDS = [
  'colheitadeira', 'trator', 'semente', 'fertilizante', 'adubo', 'calc�rio',
  'agr�cola', 'pavimenta', 'asfalto', 'recapeamento', 'merenda',
  'g�nero aliment�cio', 'material escolar', 'transporte escolar',
  'uniforme escolar', '�nibus escolar', 'ro�adeira', 'motoniveladora',
  'retroescavadeira', 'combust�vel', 'pneu para',
]

// Modalidades de interesse (codigoModalidadeContratacao do PNCP):
// 4=Concorr�ncia Eletr�nica, 6=Preg�o Eletr�nico, 8=Dispensa, 9=Inexigibilidade
const MODALIDADES_SAUDE = [6, 8, 4, 9]

function buildHeaders() {
  return {
    'Accept': 'application/json',
  }
}

export interface PNCPSearchParams {
  dataInicial?: string   // YYYY-MM-DD
  dataFinal?: string
  pagina?: number
  tamanhoPagina?: number
  uf?: string
  codigoMunicipio?: string
  modalidade?: number
  termo?: string
}

/**
 * Busca contrata��es publicadas no PNCP com filtros
 * Docs: https://pncp.gov.br/api/consulta
 */
// PNCP exige yyyyMMdd (sem h�fens)
function toYYYYMMDD(s: string): string {
  return s.replace(/-/g, '')
}

export async function buscarContratacoes(
  params: PNCPSearchParams = {}
): Promise<PNCPContratacoesResponse> {
  const searchParams = new URLSearchParams({
    dataInicial: toYYYYMMDD(params.dataInicial ?? '2025-11-01'),
    dataFinal:   toYYYYMMDD(params.dataFinal   ?? '2025-12-31'),
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: String(params.tamanhoPagina ?? 50),
  })

  if (params.uf) searchParams.set('uf', params.uf)
  if (params.codigoMunicipio) searchParams.set('codigoMunicipio', params.codigoMunicipio)
  // codigoModalidadeContratacao � obrigat�rio; default 6 = Preg�o Eletr�nico
  searchParams.set('codigoModalidadeContratacao', String(params.modalidade ?? 6))

  const url = `${PNCP_BASE}/contratacoes/publicacao?${searchParams}`

  const res = await withTimeout(
    fetch(url, { headers: buildHeaders(), next: { revalidate: 900 } }),
    18_000
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PNCP API error ${res.status}: ${text}`)
  }

  return res.json()
}

type Slot = [string, string, number, number]

/**
 * Gera janelas bimestrais din�micas do ano corrente at� o m�s atual,
 * para Preg�o Eletr�nico (6). Garante que os editais mais recentes
 * (inclusive do ano corrente) sempre entrem, sem "vencer" com datas fixas.
 */
function slotsRecentesDinamicos(): Slot[] {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mesAtual = hoje.getMonth() // 0-11
  const slots: Slot[] = []
  // Bimestres do ano corrente: jan-fev, mar-abr, mai-jun, ... at� o bimestre atual
  for (let inicioMes = 0; inicioMes <= mesAtual; inicioMes += 2) {
    const fimMes = Math.min(inicioMes + 1, 11)
    const di = `${ano}-${String(inicioMes + 1).padStart(2, '0')}-01`
    // �ltimo dia do m�s final do bimestre
    const ultimoDia = new Date(ano, fimMes + 1, 0).getDate()
    const df = `${ano}-${String(fimMes + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
    slots.push([di, df, 6, 50])
  }
  // Dispensa, Concorr�ncia Eletr�nica e Inexigibilidade do ano corrente (per�odo acumulado)
  const inicioAno = `${ano}-01-01`
  const fimMesAtual = `${ano}-${String(mesAtual + 1).padStart(2, '0')}-${String(new Date(ano, mesAtual + 1, 0).getDate()).padStart(2, '0')}`
  slots.push([inicioAno, fimMesAtual, 8, 50]) // Dispensa
  slots.push([inicioAno, fimMesAtual, 4, 40]) // Concorr�ncia Eletr�nica
  slots.push([inicioAno, fimMesAtual, 9, 30]) // Inexigibilidade
  return slots
}

/**
 * Busca compras de sa�de combinando o ano corrente (din�mico) com hist�rico.
 * PNCP limita queries longas ? usamos janelas curtas (bi-mensais/semestrais).
 * Cada tupla: [dataInicial, dataFinal, modalidade, tamanhoPagina]
 */
export async function buscarComprasSaude(params: PNCPSearchParams = {}) {
  // PNCP aceita tamanhoPagina m�x 50. Timeout por slot: 18s.
  const anoPassado = new Date().getFullYear() - 1
  const slots: Slot[] = [
    // Ano corrente � bimestral + modalidades extras (gerado dinamicamente)
    ...slotsRecentesDinamicos(),
    // Ano anterior � semestral (Preg�o) + acumulado de Dispensa
    [`${anoPassado}-07-01`, `${anoPassado}-12-31`, 6, 50],
    [`${anoPassado}-01-01`, `${anoPassado}-06-30`, 6, 50],
    [`${anoPassado}-01-01`, `${anoPassado}-12-31`, 8, 40],
    [`${anoPassado}-01-01`, `${anoPassado}-12-31`, 4, 30],
    // Dois anos atr�s � semestral (intelig�ncia de mercado / ciclo de recompra)
    [`${anoPassado - 1}-07-01`, `${anoPassado - 1}-12-31`, 6, 40],
    [`${anoPassado - 1}-01-01`, `${anoPassado - 1}-06-30`, 6, 40],
  ]

  const results = await Promise.allSettled(
    slots.map(([dataInicial, dataFinal, modalidade, tamanhoPagina]) =>
      buscarContratacoes({ ...params, dataInicial, dataFinal, modalidade, tamanhoPagina })
    )
  )

  const all: PNCPContratacao[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value.data)
  }

  // Deduplica por numeroControlePNCP
  const seen = new Set<string>()
  const unique = all.filter((c) => {
    if (seen.has(c.numeroControlePNCP)) return false
    seen.add(c.numeroControlePNCP)
    return true
  })

  const dadosSaude = unique.filter((c) => isSaudeRelated(c.objetoCompra))

  return {
    data: dadosSaude,
    totalRegistros: dadosSaude.length,
    totalPaginas: 1,
    paginaAtual: 1,
    tamanhoPagina: dadosSaude.length,
  }
}

/**
 * Busca itens de uma compra espec�fica
 */
export async function buscarItensCompra(
  cnpj: string,
  ano: number,
  sequencial: number
): Promise<ItemPNCP[]> {
  const url = `${PNCP_API}/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens?pagina=1&tamanhoPagina=100`

  const res = await fetch(url, {
    headers: buildHeaders(),
    next: { revalidate: 3600 },
  })

  if (!res.ok) return []

  const data = await res.json()
  return data.data ?? []
}

export interface ItemPNCP {
  numeroItem: number
  descricao: string
  valorUnitarioEstimado: number
  quantidade: number
  unidadeMedida: string
  situacaoCompraItemNome: string
}

export interface ResultadoCompra {
  niFornecedor: string
  nomeFornecedor: string
  valorTotalHomologado: number
  situacaoCompraItemResultadoNome?: string
}

/**
 * Busca vencedores (fornecedores) de uma compra espec�fica
 */
export async function buscarResultadoCompra(
  cnpj: string,
  anoCompra: number,
  sequencialCompra: number,
): Promise<ResultadoCompra[]> {
  const url = `${PNCP_API}/orgaos/${cnpj}/compras/${anoCompra}/${sequencialCompra}/resultado?pagina=1&tamanhoPagina=50`

  try {
    const res = await withTimeout(
      fetch(url, { headers: buildHeaders(), next: { revalidate: 3600 } }),
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
 * Busca resultados/homologa��es recentes
 */
export async function buscarResultados(params: PNCPSearchParams = {}) {
  const searchParams = new URLSearchParams({
    dataInicial: params.dataInicial ?? getDateDaysAgo(90),
    dataFinal: params.dataFinal ?? getToday(),
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: String(params.tamanhoPagina ?? 50),
  })

  if (params.uf) searchParams.set('uf', params.uf)

  const url = `${PNCP_BASE}/contratacoes/proposta?${searchParams}`

  const res = await fetch(url, {
    headers: buildHeaders(),
    next: { revalidate: 1800 },
  })

  if (!res.ok) return { data: [], totalRegistros: 0, totalPaginas: 0, paginaAtual: 1, tamanhoPagina: 50 }
  return res.json() as Promise<PNCPContratacoesResponse>
}

/**
 * Busca vencedores de preg�es de sa�de � analisa resultados para extrair concorrentes
 */
export async function buscarVencedoresSaude(uf?: string) {
  const resultados = await buscarResultados({ uf, tamanhoPagina: 200 })

  const vencedores: Record<string, { nome: string; vitorias: number; valorTotal: number }> = {}

  for (const item of resultados.data) {
    if (!isSaudeRelated(item.objetoCompra)) continue
    if (!item.valorTotalHomologado) continue

    // O PNCP n�o retorna o CNPJ vencedor na listagem � precisaria buscar
    // cada contrato individualmente. Aqui consolidamos por raz�o social do �rg�o
    // para an�lise de concentra��o de mercado.
    const key = item.orgaoEntidade.cnpj
    vencedores[key] = {
      nome: item.orgaoEntidade.razaoSocial,
      vitorias: (vencedores[key]?.vitorias ?? 0) + 1,
      valorTotal: (vencedores[key]?.valorTotal ?? 0) + (item.valorTotalHomologado ?? 0),
    }
  }

  return vencedores
}

// --- Helpers ---

export function isSaudeRelated(texto: string): boolean {
  // Dados do governo s�o inconsistentes ("SAUDE" vs "sa�de") ? normaliza acentos.
  const lower = stripAccents(texto.toLowerCase())
  // Exclui compras claramente n�o-relacionadas � sa�de (agro, obras, escolar�)
  if (NAO_SAUDE_KEYWORDS.some((kw) => lower.includes(stripAccents(kw)))) return false
  // 'uti' com fronteira de palavra (evita falsos positivos: "reutiliz�vel" etc.)
  if (/\buti\b/.test(lower)) return true
  return HEALTH_KEYWORDS.some((kw) => lower.includes(stripAccents(kw)))
}

export function normalizarLicitacao(raw: PNCPContratacao): Licitacao {
  return {
    id: raw.numeroControlePNCP,
    numeroControlePNCP: raw.numeroControlePNCP,
    orgaoEntidade: {
      cnpj: raw.orgaoEntidade.cnpj,
      razaoSocial: raw.orgaoEntidade.razaoSocial,
      municipio: raw.unidadeOrgao?.municipioNome ?? raw.orgaoEntidade.municipioNome,
      uf: raw.unidadeOrgao?.ufSigla ?? raw.orgaoEntidade.ufSigla,
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

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}
