// src/lib/comprasgov.ts
// Compras.gov.br — Painel de Preços (Pesquisa de Preço) + CATMAT
// API oficial de Dados Abertos: https://dadosabertos.compras.gov.br
// Pública, sem autenticação. Swagger: https://dadosabertos.compras.gov.br/swagger-ui.html
//
// Arquitetura de busca (importante):
//   O módulo de Pesquisa de Preço exige `codigoItemCatalogo` (código CATMAT, inteiro).
//   Não há busca por texto livre nos preços. Resolvemos o termo via a hierarquia do
//   catálogo de material: Grupo (65 = médico) > Classe > PDM (= nome do equipamento) > Item.
//   Em seguida consultamos os preços de cada código de item (com throttling — a API
//   limita rajadas agressivamente, respondendo 400/429).

import type { PrecoPainelItem, CatmatMaterial, EstatisticaPrecos } from './types'
import { withTimeout, sleep } from './http'
import { normalizeText } from './text'

const BASE =
  process.env.COMPRASGOV_DADOS_ABERTOS_BASE ??
  'https://dadosabertos.compras.gov.br'

// Grupo 65 = "Equipamentos e artigos para uso médico, dentário e veterinário".
// Classes com equipamentos/insumos/medicamentos relevantes para saúde:
//   6505 = Drogas e medicamentos · 6510 = Materiais p/ curativos · 6515 = Instrumentos/equip. médicos
//   6520 = Dentários · 6525 = Raios-X · 6530 = Mobiliário hosp. · 6540 = Oftalmo · 6550 = Diagnóstico in vitro
const CLASSES_SAUDE = [6505, 6515, 6525, 6530, 6540, 6510, 6520, 6545, 6550]

// ── Interfaces de parâmetros ───────────────────────────────────────────────────

export interface BuscaPrecosParams {
  descricao?: string
  codigoItem?: string
  uf?: string
  esfera?: string         // Federal | Estadual | Municipal | Distrital
  dataInicial?: string    // YYYY-MM-DD
  dataFinal?: string
  pagina?: number
  tamanhoPagina?: number
  maxCodigos?: number     // quantos códigos CATMAT consultar (default 8)
}

// ── Helpers de rede ─────────────────────────────────────────────────────────────

function extractArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of ['resultado', 'content', 'data', 'items', 'itens']) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[]
    }
  }
  return []
}

/**
 * GET com timeout e 1 retry com backoff — a API de dados abertos responde 400/429
 * sob rajada. O retry espaçado recupera a maioria dessas falhas transitórias.
 */
async function getJson(
  url: string,
  { timeout = 20_000, retry = true, revalidate = 86_400 } = {}
): Promise<unknown | null> {
  for (let tentativa = 0; tentativa < (retry ? 2 : 1); tentativa++) {
    try {
      const res = await withTimeout(
        fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate } }),
        timeout
      )
      if (res.ok) return await res.json()
      // 400/429 sob rajada → backoff e tenta de novo
      if ((res.status === 400 || res.status === 429) && tentativa === 0) {
        await sleep(1500)
        continue
      }
      return null
    } catch {
      if (tentativa === 0) {
        await sleep(800)
        continue
      }
      return null
    }
  }
  return null
}

// ── Resolução termo → PDM → itens (catálogo de material) ────────────────────────

// Cache em memória do processo (catálogo é estático — atualização anual).
const pdmCache = new Map<number, { codigoPdm: number; nomePdm: string }[]>()

// Mapa curado: acelera e dá confiabilidade aos equipamentos mais buscados.
// keywords (normalizadas) → códigos de PDM reais do catálogo CATMAT.
const PDM_CURADO: { kw: string[]; pdms: number[] }[] = [
  { kw: ['tomografo', 'tomografia', 'ressonancia', 'rmn'], pdms: [12812] },
  { kw: ['ultrassom', 'ultrassonografia', 'ultra-ssom', 'usg'], pdms: [7145] },
  { kw: ['ventilador', 'respirador'], pdms: [11696] },
  { kw: ['monitor', 'multiparametro', 'multiparametrico'], pdms: [13552, 9881, 15180] },
  { kw: ['desfibrilador', 'cardioversor'], pdms: [2717, 6094] },
  { kw: ['oximetro', 'oximetria'], pdms: [10260] },
  { kw: ['mamografo', 'mamografia'], pdms: [] }, // resolve via classe 6525 (sem PDM fixo)
  { kw: ['raio-x', 'raio x', 'raiox', 'radiografia'], pdms: [2666, 2738, 2866] },
]


async function listarPdmsClasse(
  codigoClasse: number
): Promise<{ codigoPdm: number; nomePdm: string }[]> {
  if (pdmCache.has(codigoClasse)) return pdmCache.get(codigoClasse)!

  const todos: { codigoPdm: number; nomePdm: string }[] = []
  // Classes de medicamento (6505) têm ~1.9k PDMs — paginamos até cobrir.
  for (let pagina = 1; pagina <= 5; pagina++) {
    const url = `${BASE}/modulo-material/3_consultarPdmMaterial?pagina=${pagina}&tamanhoPagina=500&codigoClasse=${codigoClasse}`
    const json = await getJson(url)
    const arr = extractArray(json)
    if (arr.length === 0) break
    for (const r of arr) {
      todos.push({ codigoPdm: Number(r.codigoPdm), nomePdm: String(r.nomePdm ?? '') })
    }
    if (arr.length < 500) break
    await sleep(300)
  }
  pdmCache.set(codigoClasse, todos)
  return todos
}

/**
 * Resolve um termo de busca para uma lista de códigos PDM do catálogo.
 * 1) tenta o mapa curado; 2) busca por nome de PDM nas classes de saúde.
 */
async function resolverPdms(termo: string): Promise<number[]> {
  const t = normalizeText(termo)
  const palavras = t.split(/\s+/).filter((w) => w.length >= 3)

  // 1) Mapa curado
  const curado = PDM_CURADO.find((e) => e.kw.some((k) => t.includes(normalizeText(k))))
  const pdms = new Set<number>(curado?.pdms ?? [])

  // 2) Busca por nome de PDM nas classes de saúde (catálogo cacheado)
  for (const classe of CLASSES_SAUDE) {
    const lista = await listarPdmsClasse(classe)
    for (const pdm of lista) {
      const nome = normalizeText(pdm.nomePdm)
      // casa se alguma palavra do termo aparece no nome do PDM
      if (palavras.some((w) => nome.includes(w))) pdms.add(pdm.codigoPdm)
    }
    // Já temos candidatos suficientes — evita varrer todas as classes
    if (pdms.size >= 6) break
  }

  return [...pdms]
}

interface ItemCatalogo {
  codigoItem: number
  descricaoItem: string
  nomePdm?: string
  nomeClasse?: string
  unidade?: string
}

async function listarItensPorPdm(codigoPdm: number): Promise<ItemCatalogo[]> {
  const url = `${BASE}/modulo-material/4_consultarItemMaterial?pagina=1&tamanhoPagina=50&codigoPdm=${codigoPdm}&statusItem=true`
  const json = await getJson(url)
  return extractArray(json).map((r) => ({
    codigoItem: Number(r.codigoItem),
    descricaoItem: String(r.descricaoItem ?? ''),
    nomePdm: r.nomePdm ? String(r.nomePdm) : undefined,
    nomeClasse: r.nomeClasse ? String(r.nomeClasse) : undefined,
    unidade: r.nomeUnidadeFornecimento ? String(r.nomeUnidadeFornecimento) : undefined,
  }))
}

async function listarItensPorClasse(
  codigoClasse: number,
  termo: string
): Promise<ItemCatalogo[]> {
  const palavras = normalizeText(termo).split(/\s+/).filter((w) => w.length >= 3)
  const encontrados: ItemCatalogo[] = []
  for (let pagina = 1; pagina <= 3 && encontrados.length < 40; pagina++) {
    const url = `${BASE}/modulo-material/4_consultarItemMaterial?pagina=${pagina}&tamanhoPagina=500&codigoClasse=${codigoClasse}&statusItem=true`
    const json = await getJson(url)
    const arr = extractArray(json)
    if (arr.length === 0) break
    for (const r of arr) {
      const desc = normalizeText(String(r.descricaoItem ?? ''))
      if (palavras.some((w) => desc.includes(w))) {
        encontrados.push({
          codigoItem: Number(r.codigoItem),
          descricaoItem: String(r.descricaoItem ?? ''),
          nomePdm: r.nomePdm ? String(r.nomePdm) : undefined,
          nomeClasse: r.nomeClasse ? String(r.nomeClasse) : undefined,
        })
      }
    }
    if (arr.length < 500) break
    await sleep(300)
  }
  return encontrados
}

/**
 * Resolve um termo de busca para uma lista de códigos CATMAT (codigoItemCatalogo),
 * priorizando códigos mais novos (número maior → maior chance de ter preços recentes).
 */
async function resolverCodigosItem(termo: string, max = 8): Promise<ItemCatalogo[]> {
  const t = normalizeText(termo)
  const pdms = await resolverPdms(termo)
  const itens: ItemCatalogo[] = []

  for (const pdm of pdms) {
    itens.push(...(await listarItensPorPdm(pdm)))
    await sleep(250)
    if (itens.length >= 60) break
  }

  // Equipamentos de imagem têm PDMs legados (códigos vazios) no catálogo antigo.
  // A classe 6525 (raios-X, ~1.1k itens) é totalmente varrível e tem os códigos modernos.
  const ehImagem = /raio|ra-?x|mamograf|radiograf|tomograf|ressonan|densitometr|angiograf/.test(t)
  if (ehImagem) {
    itens.push(...(await listarItensPorClasse(6525, termo)))
  }

  // Dedup + prioriza códigos modernos (maiores) que tendem a ter dados de preço
  const seen = new Set<number>()
  const unicos = itens.filter((i) => {
    if (!i.codigoItem || seen.has(i.codigoItem)) return false
    seen.add(i.codigoItem)
    return true
  })
  unicos.sort((a, b) => b.codigoItem - a.codigoItem)
  return unicos.slice(0, max)
}

// ── Normalização de item de preço (Pesquisa de Preço) ───────────────────────────

function normalizarItemPreco(raw: Record<string, unknown>): PrecoPainelItem {
  const valorUnit = Number(raw.precoUnitario ?? raw.valorUnitario ?? 0)
  const qtd = Number(raw.quantidade ?? 1) || 1
  const data = String(raw.dataCompra ?? raw.dataResultado ?? '')

  return {
    id: String(raw.idItemCompra ?? raw.idCompra ?? Math.random()),
    codigoItem: String(raw.codigoItemCatalogo ?? ''),
    descricaoItem: String(raw.descricaoItem ?? raw.descricaoDetalhadaItem ?? ''),
    unidadeMedida: String(
      raw.siglaUnidadeFornecimento ?? raw.nomeUnidadeFornecimento ?? 'UN'
    ),
    valorUnitario: valorUnit,
    quantidade: qtd,
    valorTotal: valorUnit * qtd,
    dataResultado: data,
    nomeOrgao: String(raw.nomeOrgao ?? raw.nomeUasg ?? ''),
    siglaUf: String(raw.estado ?? ''),
    municipio: raw.municipio ? String(raw.municipio) : undefined,
    cnpjFornecedor: String(raw.niFornecedor ?? ''),
    razaoSocialFornecedor: String(raw.nomeFornecedor ?? ''),
    numeroDocumento: raw.idCompra ? String(raw.idCompra) : undefined,
    origem: 'contrato',
    // Campos enriquecidos (era PNCP / Lei 14.133)
    marca: raw.marca ? String(raw.marca) : undefined,
    esfera: raw.esfera ? String(raw.esfera) : undefined,
    poder: raw.poder ? String(raw.poder) : undefined,
    modalidade: raw.modalidade != null ? Number(raw.modalidade) : undefined,
    nomeClasse: raw.nomeClasse ? String(raw.nomeClasse) : undefined,
    objetoCompra: raw.objetoCompra ? String(raw.objetoCompra) : undefined,
    // A Painel de Preços do governo é 100% compra pública.
    tipoCompra: 'publica',
  }
}

// ── Consulta de preços por código CATMAT ────────────────────────────────────────

async function consultarPrecoItem(
  codigoItemCatalogo: number,
  params: BuscaPrecosParams = {}
): Promise<PrecoPainelItem[]> {
  const sp = new URLSearchParams({
    pagina: '1',
    tamanhoPagina: String(params.tamanhoPagina ?? 50),
    codigoItemCatalogo: String(codigoItemCatalogo),
  })
  if (params.uf) sp.set('estado', params.uf)
  if (params.esfera) sp.set('esfera', params.esfera)
  if (params.dataInicial) sp.set('dataCompraInicio', params.dataInicial)
  if (params.dataFinal) sp.set('dataCompraFim', params.dataFinal)

  const url = `${BASE}/modulo-pesquisa-preco/1_consultarMaterial?${sp}`
  const json = await getJson(url, { revalidate: 86_400 })
  return extractArray(json).map(normalizarItemPreco)
}

// ── Busca combinada de preços de saúde (entrada principal) ───────────────────────

/**
 * Resolve o termo → códigos CATMAT → consulta preços de cada código (com throttling).
 * Retorna preços de referência (compra pública) ordenados do mais recente ao mais antigo.
 */
export async function buscarPrecosSaude(
  descricao: string,
  uf?: string,
  params: Omit<BuscaPrecosParams, 'descricao' | 'uf'> = {}
): Promise<PrecoPainelItem[]> {
  // O módulo de Pesquisa de Preço tem rate-limit agressivo (responde 400 sob rajada).
  // Consultamos poucos códigos por busca, com throttle e parada antecipada,
  // e confiamos no cache de 24h da rota para acumular cobertura ao longo do tempo.
  const max = params.maxCodigos ?? 4
  let itens: ItemCatalogo[]

  // Se veio um código CATMAT explícito, consulta direto.
  if (params.codigoItem && /^\d+$/.test(params.codigoItem)) {
    itens = [{ codigoItem: Number(params.codigoItem), descricaoItem: descricao }]
  } else {
    itens = await resolverCodigosItem(descricao, max)
  }

  const todos: PrecoPainelItem[] = []
  for (const item of itens) {
    const precos = await consultarPrecoItem(item.codigoItem, { uf, esfera: params.esfera, dataInicial: params.dataInicial, dataFinal: params.dataFinal })
    // Garante descrição legível mesmo quando o preço não traz uma boa descrição
    for (const p of precos) {
      if (!p.descricaoItem && item.descricaoItem) p.descricaoItem = item.descricaoItem
    }
    todos.push(...precos)
    // Parada antecipada — já temos amostra suficiente, evita disparar o rate-limit
    if (todos.length >= 30) break
    await sleep(900) // throttle entre consultas de preço
  }

  // Dedup por (código + fornecedor + data + valor) e ordena do mais recente
  const seen = new Set<string>()
  const unicos = todos.filter((p) => {
    const k = `${p.codigoItem}|${p.cnpjFornecedor}|${p.dataResultado}|${p.valorUnitario}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return unicos.sort(
    (a, b) => new Date(b.dataResultado).getTime() - new Date(a.dataResultado).getTime()
  )
}

// ── CATMAT (para o painel "Códigos CATMAT" da página) ───────────────────────────

export async function buscarMaterialCATMAT(
  descricao: string,
  _params: { status?: string; pagina?: number; tamanhoPagina?: number } = {}
): Promise<CatmatMaterial[]> {
  const itens = await resolverCodigosItem(descricao, 12)
  return itens.map((i) => ({
    codigo: String(i.codigoItem),
    descricao: i.descricaoItem,
    unidadeFornecimento: i.unidade ?? 'UN',
    status: 'ATIVO',
    classe: i.nomeClasse,
    pdm: i.nomePdm,
  }))
}

// ── Estatísticas de preços ────────────────────────────────────────────────────

export function calcularEstatisticas(precos: PrecoPainelItem[]): EstatisticaPrecos {
  if (precos.length === 0) {
    return { total: 0, valorMin: 0, valorMax: 0, valorMedio: 0, valorMediano: 0, fornecedoresUnicos: 0, orgaosUnicos: 0 }
  }

  const valores = precos
    .map((p) => p.valorUnitario)
    .filter((v) => v > 0)
    .sort((a, b) => a - b)

  const soma = valores.reduce((s, v) => s + v, 0)
  const mediana =
    valores.length === 0
      ? 0
      : valores.length % 2 === 0
        ? (valores[valores.length / 2 - 1] + valores[valores.length / 2]) / 2
        : valores[Math.floor(valores.length / 2)]

  return {
    total: precos.length,
    valorMin: valores[0] ?? 0,
    valorMax: valores[valores.length - 1] ?? 0,
    valorMedio: valores.length ? Math.round(soma / valores.length) : 0,
    valorMediano: Math.round(mediana),
    fornecedoresUnicos: new Set(precos.map((p) => p.cnpjFornecedor).filter(Boolean)).size,
    orgaosUnicos: new Set(precos.map((p) => p.nomeOrgao).filter(Boolean)).size,
  }
}

// ── Termos de equipamentos de saúde (atalhos) ────────────────────────────────────

export const HEALTH_EQUIPMENT_TERMS = [
  'tomógrafo',
  'ressonância magnética',
  'ultrassom',
  'raio-x',
  'mamógrafo',
  'ventilador pulmonar',
  'monitor multiparamétrico',
  'desfibrilador',
  'oxímetro',
] as const
