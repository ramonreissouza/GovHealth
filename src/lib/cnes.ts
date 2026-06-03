// src/lib/cnes.ts
// CNES — Cadastro Nacional de Estabelecimentos de Saúde (DATASUS)
// API pública, sem autenticação
// Base: https://cnes.datasus.gov.br/services/v1/

import { withTimeout } from './http'

const CNES_BASE =
  process.env.CNES_BASE_URL ?? 'https://cnes.datasus.gov.br/services/v1'

export interface CnesEstabelecimento {
  codigoEstabelecimento: string
  nomeFantasia: string
  razaoSocial: string
  cnpj: string
  codigoMunicipio: string
  municipio: string
  uf: string
  tipoGestao: 'federal' | 'estadual' | 'municipal' | 'dupla' | 'sem-gestao'
  leitos: number
  leitosSUS: number
  tipoUnidade: string
}

// Tipos de gestão DATASUS: F=Federal, E=Estadual, M=Municipal, D=Dupla, S=Sem-gestão
function normalizarGestao(
  tpGestao?: string
): CnesEstabelecimento['tipoGestao'] {
  switch ((tpGestao ?? '').toUpperCase()) {
    case 'F': return 'federal'
    case 'E': return 'estadual'
    case 'M': return 'municipal'
    case 'D': return 'dupla'
    default:  return 'sem-gestao'
  }
}

function normalizarEstabelecimento(raw: Record<string, unknown>): CnesEstabelecimento {
  return {
    codigoEstabelecimento: String(raw.coEstabelecimento ?? raw.codigo ?? ''),
    nomeFantasia: String(raw.noFantasia ?? raw.nomeFantasia ?? raw.nome ?? ''),
    razaoSocial: String(raw.noRazaoSocial ?? raw.razaoSocial ?? ''),
    cnpj: String(raw.nuCnpj ?? raw.cnpj ?? '').replace(/\D/g, ''),
    codigoMunicipio: String(raw.coMunicipio ?? raw.codigoMunicipio ?? ''),
    municipio: String(raw.noMunicipio ?? raw.municipio ?? ''),
    uf: String(raw.sgUf ?? raw.uf ?? ''),
    tipoGestao: normalizarGestao(String(raw.tpGestao ?? raw.tipoGestao ?? '')),
    leitos: Number(raw.nuLeitos ?? raw.leitos ?? 0),
    leitosSUS: Number(raw.nuLeitosSus ?? raw.leitosSUS ?? 0),
    tipoUnidade: String(raw.noTipoUnidade ?? raw.tipoUnidade ?? 'Hospital'),
  }
}

function extractContent(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const key of ['content', 'data', 'resultado', 'items', 'estabelecimentos']) {
      if (Array.isArray(o[key])) return o[key] as unknown[]
    }
  }
  return []
}


/**
 * Busca estabelecimentos CNES por município (código IBGE)
 * Retorna hospitais e unidades de saúde da área
 */
export async function buscarEstabelecimentosMunicipio(
  codigoMunicipio: string,
  pagina = 0,
  tamanho = 50
): Promise<CnesEstabelecimento[]> {
  const url = `${CNES_BASE}/estabelecimentos/municipio/${codigoMunicipio}?page=${pagina}&size=${tamanho}`

  try {
    const res = await withTimeout(
      fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 86_400 }, // 24h — dados CNES mudam pouco
      }),
      12_000
    )
    if (!res.ok) return []
    const data = await res.json()
    return extractContent(data).map((r) =>
      normalizarEstabelecimento(r as Record<string, unknown>)
    )
  } catch {
    return []
  }
}

/**
 * Busca um estabelecimento específico pelo código CNES
 */
export async function buscarEstabelecimento(
  codigoEstabelecimento: string
): Promise<CnesEstabelecimento | null> {
  const url = `${CNES_BASE}/estabelecimentos/${codigoEstabelecimento}`

  try {
    const res = await withTimeout(
      fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 86_400 },
      }),
      10_000
    )
    if (!res.ok) return null
    const data = await res.json()
    const raw = Array.isArray(data) ? data[0] : data
    if (!raw || typeof raw !== 'object') return null
    return normalizarEstabelecimento(raw as Record<string, unknown>)
  } catch {
    return null
  }
}

/**
 * Busca estabelecimento CNES pelo CNPJ do órgão
 * Útil para enriquecer licitações do PNCP com dados hospitalares
 */
export async function buscarEstabelecimentoPorCNPJ(
  cnpj: string
): Promise<CnesEstabelecimento | null> {
  const cnpjLimpo = cnpj.replace(/\D/g, '')
  const url = `${CNES_BASE}/estabelecimentos?nuCnpj=${cnpjLimpo}&page=0&size=1`

  try {
    const res = await withTimeout(
      fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 86_400 },
      }),
      10_000
    )
    if (!res.ok) return null
    const data = await res.json()
    const items = extractContent(data)
    if (items.length === 0) return null
    return normalizarEstabelecimento(items[0] as Record<string, unknown>)
  } catch {
    return null
  }
}

/**
 * Enriquece dados do score engine com informações CNES de um hospital
 * Retorna leitos e categoria para uso em ScoreInput
 */
export async function enriquecerComCNES(cnpj: string): Promise<{
  leitos: number
  categoriaHospital: 'federal' | 'estadual' | 'municipal' | 'privado'
} | null> {
  const est = await buscarEstabelecimentoPorCNPJ(cnpj)
  if (!est) return null

  const categoriaMap: Record<CnesEstabelecimento['tipoGestao'], 'federal' | 'estadual' | 'municipal' | 'privado'> = {
    federal: 'federal',
    estadual: 'estadual',
    municipal: 'municipal',
    dupla: 'estadual',
    'sem-gestao': 'privado',
  }

  return {
    leitos: est.leitos,
    categoriaHospital: categoriaMap[est.tipoGestao],
  }
}

/**
 * Busca hospitais com mais leitos por UF — útil para priorizar oportunidades
 */
export async function buscarHospitaisUF(
  uf: string,
  limite = 20
): Promise<CnesEstabelecimento[]> {
  const url = `${CNES_BASE}/estabelecimentos?sgUf=${uf}&coTipoUnidade=5&page=0&size=${limite}`

  try {
    const res = await withTimeout(
      fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 86_400 },
      }),
      12_000
    )
    if (!res.ok) return []
    const data = await res.json()
    const items = extractContent(data).map((r) =>
      normalizarEstabelecimento(r as Record<string, unknown>)
    )
    return items
      .filter((e) => e.leitos > 0)
      .sort((a, b) => b.leitos - a.leitos)
      .slice(0, limite)
  } catch {
    return []
  }
}
