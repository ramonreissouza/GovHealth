// src/lib/transferegov.ts — VERSÃO FINAL (calibrada com debug)
//
// Confirmado via debug:
// - /convenios EXIGE filtro (uf, codigoIBGE, etc) — sem filtro retorna 400
// - estrutura real: objeto vem em dimConvenio.objeto (não no nível raiz)
// - retorna campos: id, dataInicioVigencia, dataFinalVigencia, dataPublicacao, etc.

import { Convenio } from './types'
import { normalizeKey } from './text'

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados'

// UFs para varrer quando se quer cobertura nacional
const TODAS_UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
  'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]

function buildHeaders() {
  const key = process.env.PORTAL_TRANSPARENCIA_API_KEY
  if (!key) throw new Error('PORTAL_TRANSPARENCIA_API_KEY não configurada')
  return { 'chave-api-dados': key, Accept: 'application/json' }
}

// Estrutura real retornada pela API (confirmada no debug)
interface ConvenioRaw {
  id: number
  dataInicioVigencia?: string
  dataFinalVigencia?: string
  dataPublicacao?: string
  dataUltimaLiberacao?: string
  dataConclusao?: string | null
  dimConvenio?: {
    codigo?: string
    objeto?: string
    situacao?: string
    valor?: number
    valorLiberado?: number
    valorContrapartida?: number
  }
  convenente?: {
    nome?: string
    municipio?: { nomeIBGE?: string; uf?: { sigla?: string } }
  }
  // campos podem variar; mantém flexível
  [key: string]: unknown
}

const HEALTH_KW = [
  'saúde','saude','hospital','médic','medic','medicamento','equipamento médic',
  'uti','enfermagem','clínic','ambulânc','posto de saúde','unidade básica',
  'ubs','upa','sus','farmácia','laboratório','odontológ','cirúrg',
]

function isSaudeConvenio(objeto: string): boolean {
  const l = (objeto ?? '').toLowerCase()
  return HEALTH_KW.some((k) => l.includes(k))
}

export interface ConveniosParams {
  uf: string // OBRIGATÓRIO
  pagina?: number
}

/**
 * Busca convênios de UMA UF (filtro obrigatório).
 */
export async function buscarConveniosUF(params: ConveniosParams): Promise<Convenio[]> {
  const sp = new URLSearchParams({
    uf: params.uf,
    pagina: String(params.pagina ?? 1),
  })

  const res = await fetch(`${BASE_URL}/convenios?${sp}`, { headers: buildHeaders(), next: { revalidate: 3600 } })
  if (!res.ok) {
    if (res.status === 400) throw new Error('Convênios 400 — filtro obrigatório ausente')
    throw new Error(`Convênios ${res.status}`)
  }
  const data: ConvenioRaw[] = await res.json()
  return Array.isArray(data) ? data.map(normalizar) : []
}

/**
 * Busca convênios de saúde de uma UF (filtra pelo objeto).
 */
export async function buscarConveniosSaudeUF(uf: string, maxPaginas = 5): Promise<Convenio[]> {
  const todos: Convenio[] = []
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const lote = await buscarConveniosUF({ uf, pagina })
    if (lote.length === 0) break
    todos.push(...lote.filter((c) => isSaudeConvenio(c.objeto)))
    await new Promise((r) => setTimeout(r, 400))
  }
  return todos
}

/**
 * Cobertura nacional: varre UFs prioritárias (ou todas).
 * Use ufs limitado em request de página; todas só em sync.
 */
export async function buscarConveniosSaudeNacional(
  ufs: string[] = ['SP','RJ','MG','BA','CE','PE','PR','RS','PA','AM']
): Promise<Convenio[]> {
  const resultados = await Promise.allSettled(ufs.map((uf) => buscarConveniosSaudeUF(uf, 3)))
  const todos: Convenio[] = []
  for (const r of resultados) {
    if (r.status === 'fulfilled') todos.push(...r.value)
  }
  return todos
}

function normalizar(raw: ConvenioRaw): Convenio {
  const dim = raw.dimConvenio ?? {}
  const valorTotal = dim.valor ?? 0
  const valorLiberado = dim.valorLiberado ?? 0
  const pct = valorTotal > 0 ? Math.round((valorLiberado / valorTotal) * 100) : 0

  return {
    id: String(raw.id),
    numero: dim.codigo ?? String(raw.id),
    objeto: dim.objeto ?? '',
    situacao: dim.situacao ?? 'N/D',
    valorTotal,
    valorLiberado,
    valorContrapartida: dim.valorContrapartida ?? 0,
    dataInicio: raw.dataInicioVigencia ?? '',
    dataFim: raw.dataFinalVigencia ?? '',
    municipio: raw.convenente?.municipio?.nomeIBGE ?? '',
    uf: raw.convenente?.municipio?.uf?.sigla ?? '',
    orgaoConcedente: '',
    convenente: raw.convenente?.nome ?? '',
    percentualExecutado: pct,
  }
}

export function diasAteVencimento(dataFim: string): number {
  if (!dataFim) return 999
  const fim = new Date(dataFim).getTime()
  return Math.ceil((fim - Date.now()) / 86_400_000)
}

/**
 * Busca convênios de um município específico (em execução por padrão).
 * A API exige pelo menos um filtro de localidade (município e/ou UF).
 */
export async function buscarConveniosMunicipio(
  municipio: string,
  uf?: string,
  pagina = 1,
): Promise<Convenio[]> {
  const sp = new URLSearchParams({
    municipio,
    situacao: 'Em Execução',
    pagina: String(pagina),
  })
  if (uf) sp.set('uf', uf)

  const res = await fetch(`${BASE_URL}/convenios?${sp}`, { headers: buildHeaders(), next: { revalidate: 3600 } })
  if (!res.ok) {
    if (res.status === 400) throw new Error('Convênios 400 — filtro obrigatório ausente')
    throw new Error(`Convênios ${res.status}`)
  }
  const data: ConvenioRaw[] = await res.json()
  return Array.isArray(data) ? data.map(normalizar) : []
}

/**
 * Busca repasses (transferências voluntárias) do Portal da Transparência.
 * Retorna o payload cru da API (estrutura varia por endpoint).
 */
export async function buscarRepasses(params: {
  uf?: string
  municipio?: string
  funcao?: string
  pagina?: number
} = {}): Promise<unknown[]> {
  const sp = new URLSearchParams({
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: '50',
  })
  if (params.uf) sp.set('uf', params.uf)
  if (params.municipio) sp.set('municipio', params.municipio)
  if (params.funcao) sp.set('funcao', params.funcao)

  const res = await fetch(`${BASE_URL}/transferencias-voluntarias?${sp}`, {
    headers: buildHeaders(),
    next: { revalidate: 3600 },
  })
  if (!res.ok) return []
  return res.json()
}

/**
 * Busca emendas parlamentares de saúde por UF — verbas novas que geram oportunidades
 * ("emendas quentes"). Retorna o payload cru da API de emendas.
 */
export async function buscarEmendasSaude(params: {
  uf?: string
  ano?: number
  pagina?: number
  funcao?: string  // código de função orçamentária: '10' = Saúde
} = {}): Promise<Array<Record<string, unknown>>> {
  if (!params.uf) return []

  const ano = params.ano ?? new Date().getFullYear()
  const sp = new URLSearchParams({
    pagina: String(params.pagina ?? 1),
    tamanhoPagina: '50',
    ano: String(ano),
    uf: params.uf,
  })
  if (params.funcao) sp.set('funcao', params.funcao)

  const res = await fetch(`${BASE_URL}/emendas?${sp}`, { headers: buildHeaders(), next: { revalidate: 7200 } })
  if (!res.ok) return []
  const json = await res.json()
  return Array.isArray(json) ? json : (json.value ?? [])
}

/**
 * Conjunto de municípios (chave normalizada) com emendas de saúde ativas.
 * Usado pelo score engine para elevar o score de convênios nesses municípios.
 * Falha silenciosamente (Set vazio) se a API key não estiver configurada.
 */
export async function getMunicipiosComEmendasSaude(uf: string): Promise<Set<string>> {
  try {
    const emendas = await buscarEmendasSaude({ uf, funcao: '10' })
    const set = new Set<string>()
    for (const e of emendas) {
      const nome = (e.municipio ?? e.localidade ?? e.nomeUnidade) as string | undefined
      if (nome) set.add(normalizeKey(nome))
    }
    return set
  } catch {
    return new Set()
  }
}
