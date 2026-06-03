// src/lib/transferegov.ts
// Portal da Transparência — API de convênios (TransfereGov / SICONV)
// Documentação: https://portaldatransparencia.gov.br/api-de-dados
// Cadastro gratuito de chave: https://portaldatransparencia.gov.br/api-de-dados

import { Convenio, TranspGovConvenio } from './types'
import { normalizeKey } from './text'

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados'
const API_KEY = process.env.PORTAL_TRANSPARENCIA_API_KEY ?? ''

function buildHeaders() {
  if (!API_KEY) {
    throw new Error(
      'PORTAL_TRANSPARENCIA_API_KEY não configurada. ' +
        'Cadastre-se em https://portaldatransparencia.gov.br/api-de-dados'
    )
  }
  return {
    'chave-api-dados': API_KEY,
    'Accept': 'application/json',
  }
}

export interface ConveniosParams {
  situacao?: string
  uf?: string
  municipio?: string
  orgaoSuperior?: string
  dataInicio?: string   // DD/MM/YYYY
  dataFim?: string
  pagina?: number
  tamanhoPagina?: number
}

/**
 * Busca convênios do TransfereGov
 * A API exige ao menos um filtro: uf, municipio, orgao, data ou número do convênio
 */
export async function buscarConvenios(
  params: ConveniosParams = {}
): Promise<{ convenios: Convenio[]; total: number }> {
  const searchParams = new URLSearchParams({
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: String(params.tamanhoPagina ?? 50),
  })

  if (params.situacao) searchParams.set('situacao', params.situacao)
  if (params.uf) searchParams.set('uf', params.uf)
  if (params.municipio) searchParams.set('municipio', params.municipio)
  if (params.orgaoSuperior) searchParams.set('codigoOrgaoSuperior', params.orgaoSuperior)
  if (params.dataInicio) searchParams.set('dataInicio', params.dataInicio)
  if (params.dataFim) searchParams.set('dataFim', params.dataFim)

  const url = `${BASE_URL}/convenios?${searchParams}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  let res: Response
  try {
    res = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
      next: { revalidate: 3600 },
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`TransfereGov API error ${res.status}: ${text}`)
  }

  const json = await res.json()
  // A API retorna { value: [...] }
  const raw: TranspGovConvenio[] = Array.isArray(json) ? json : (json.value ?? [])

  return {
    convenios: raw.map(normalizarConvenio),
    total: raw.length,
  }
}

const HEALTH_KEYWORDS_PT = ['saúde', 'hospital', 'uti', 'médico', 'equipamento médico', 'laborat', 'hemot', 'oncol', 'cirurg', 'tomógrafo', 'ressonância', 'medicament', 'fármaco', 'farmacêut', 'vacina']

function isConvenioSaude(objeto: string): boolean {
  const lower = objeto.toLowerCase()
  return HEALTH_KEYWORDS_PT.some((kw) => lower.includes(kw))
}

/**
 * Busca convênios de saúde ativos por UF
 * A API do Portal da Transparência exige ao menos uma localidade (uf/município),
 * por isso retorna vazio quando nenhuma UF é informada.
 */
export async function buscarConveniosSaudeAtivos(uf?: string) {
  if (!uf) return { convenios: [], total: 0 }

  const result = await buscarConvenios({ uf, tamanhoPagina: 100 })
  const saude = result.convenios.filter((c) => isConvenioSaude(c.objeto))
  return { convenios: saude, total: saude.length }
}

/**
 * Busca convênios de um município específico
 */
export async function buscarConveniosMunicipio(municipio: string, uf?: string) {
  return buscarConvenios({
    municipio,
    uf,
    situacao: 'Em Execução',
    tamanhoPagina: 50,
  })
}

/**
 * Busca repasses (transferências diretas) do Portal da Transparência
 */
export async function buscarRepasses(params: {
  uf?: string
  municipio?: string
  funcao?: string
  pagina?: number
} = {}) {
  const searchParams = new URLSearchParams({
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: '50',
  })

  if (params.uf) searchParams.set('uf', params.uf)
  if (params.municipio) searchParams.set('municipio', params.municipio)
  if (params.funcao) searchParams.set('funcao', params.funcao)

  const url = `${BASE_URL}/transferencias-voluntarias?${searchParams}`

  const res = await fetch(url, {
    headers: buildHeaders(),
    next: { revalidate: 3600 },
  })

  if (!res.ok) return []
  return res.json()
}

/**
 * Busca emendas parlamentares de saúde
 * Fonte crucial para detectar verbas novas que geram oportunidades
 */
export async function buscarEmendasSaude(params: {
  uf?: string
  ano?: number
  pagina?: number
  funcao?: string  // código de função orçamentária: '10' = Saúde
} = {}) {
  if (!params.uf) return []

  const ano = params.ano ?? new Date().getFullYear()
  const searchParams = new URLSearchParams({
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: '50',
    ano: String(ano),
  })
  searchParams.set('uf', params.uf)
  if (params.funcao) searchParams.set('funcao', params.funcao)

  const url = `${BASE_URL}/emendas?${searchParams}`

  const res = await fetch(url, {
    headers: buildHeaders(),
    next: { revalidate: 7200 },
  })

  if (!res.ok) return []
  const json = await res.json()
  return Array.isArray(json) ? json : (json.value ?? [])
}

/**
 * Retorna o conjunto de municípios com emendas parlamentares de saúde ativas.
 * Usado pelo score engine para elevar o score de convênios nesses municípios.
 * Falha silenciosamente (retorna Set vazio) se API key não estiver configurada.
 */
export async function getMunicipiosComEmendasSaude(uf: string): Promise<Set<string>> {
  try {
    const emendas = await buscarEmendasSaude({ uf, funcao: '10' })
    const set = new Set<string>()
    for (const e of emendas) {
      const nome: string | undefined = e.municipio ?? e.localidade ?? e.nomeUnidade
      if (nome) set.add(normalizarMunicipio(nome))
    }
    return set
  } catch {
    return new Set()
  }
}

function normalizarMunicipio(nome: string): string {
  return normalizeKey(nome)
}

// --- Helpers ---

export function normalizarConvenio(raw: TranspGovConvenio): Convenio {
  const percentualExecutado =
    raw.valor > 0
      ? Math.round((raw.valorLiberado / raw.valor) * 100)
      : 0

  return {
    id: String(raw.id),
    numero: raw.dimConvenio.numero,
    objeto: raw.dimConvenio.objeto,
    situacao: raw.situacao,
    valorTotal: raw.valor,
    valorLiberado: raw.valorLiberado,
    valorContrapartida: raw.valorContrapartida,
    dataInicio: raw.dataInicioVigencia,
    dataFim: raw.dataFinalVigencia,
    municipio: raw.municipioConvenente?.nomeIBGE ?? '',
    uf: raw.municipioConvenente?.uf?.nome ?? '',  // campo "nome" é a sigla (SP, MG…)
    orgaoConcedente: raw.orgao?.nome ?? '',
    convenente: raw.convenente?.nome ?? '',
    percentualExecutado,
  }
}

/**
 * Calcula dias restantes até o vencimento do convênio
 */
export function diasAteVencimento(dataFim: string): number {
  const fim = new Date(dataFim)
  const hoje = new Date()
  const diff = fim.getTime() - hoje.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/**
 * Verifica se um convênio está em estado favorável para gerar licitação
 */
export function convenioEstaQuente(convenio: Convenio): boolean {
  const dias = diasAteVencimento(convenio.dataFim)
  return (
    convenio.percentualExecutado >= 50 &&
    convenio.valorLiberado > 0 &&
    dias > 0 &&
    dias < 365
  )
}
