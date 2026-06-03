// src/lib/dou.ts
// Diário Oficial da União — Portal da Transparência API
// Requer PORTAL_TRANSPARENCIA_API_KEY
// Docs: https://portaldatransparencia.gov.br/api-de-dados

import { withTimeout } from './http'

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados'
const API_KEY = process.env.PORTAL_TRANSPARENCIA_API_KEY ?? ''

// Palavras-chave de saúde para filtrar publicações do DOU
const HEALTH_KEYWORDS = [
  'equipamento médico',
  'equipamento hospitalar',
  'tomógrafo',
  'ressonância',
  'ultrassom',
  'ventilador',
  'respirador',
  'desfibrilador',
  'monitor multiparamétrico',
  'bomba de infusão',
  'raio-x',
  'mamógrafo',
  'endoscópio',
  'autoclave',
  'analisador hematológico',
  'oxímetro',
  'mesa cirúrgica',
  'material médico',
  'saúde',
  'hospital',
  // Medicamentos / insumos farmacêuticos
  'medicament',
  'fármaco',
  'farmacêut',
  'antibiótic',
  'insumo farmac',
  'vacina',
]

export interface DouAviso {
  id: string
  data: string
  secao: string
  numero: string
  titulo: string
  resumo: string
  tipoPublicacao: string
  orgao?: string
  urlTexto?: string
  municipio?: string
  uf?: string
  valorEstimado?: number
}

function buildHeaders() {
  if (!API_KEY) {
    throw new Error('PORTAL_TRANSPARENCIA_API_KEY não configurada.')
  }
  return {
    'chave-api-dados': API_KEY,
    Accept: 'application/json',
  }
}

function isSaudeRelated(texto: string): boolean {
  const lower = texto.toLowerCase()
  return HEALTH_KEYWORDS.some((kw) => lower.includes(kw))
}

function extrairValor(texto: string): number | undefined {
  // Tenta extrair valor monetário do resumo (ex: "R$ 1.234.567,00")
  const match = texto.match(/R\$\s*([\d.]+,\d{2})/i)
  if (!match) return undefined
  const valorStr = match[1].replace(/\./g, '').replace(',', '.')
  const valor = parseFloat(valorStr)
  return isNaN(valor) ? undefined : valor
}

function normalizarAviso(raw: Record<string, unknown>): DouAviso {
  const resumo = String(raw.resumo ?? raw.texto ?? raw.ementa ?? raw.descricao ?? '')
  const titulo = String(raw.titulo ?? raw.tipoPublicacao ?? raw.tipo ?? '')
  const orgao = String(raw.orgao ?? raw.orgaoPublicador ?? raw.nomeOrgao ?? '')

  return {
    id: String(raw.id ?? raw.idDiario ?? raw.numero ?? Math.random()),
    data: String(raw.data ?? raw.dataPublicacao ?? raw.dataDiario ?? ''),
    secao: String(raw.secao ?? raw.secaoDiario ?? '3'),
    numero: String(raw.numeroDiario ?? raw.numeroDO ?? raw.numero ?? ''),
    titulo: titulo.substring(0, 100),
    resumo: resumo.substring(0, 500),
    tipoPublicacao: String(raw.tipoPublicacao ?? raw.tipo ?? 'AVISO'),
    orgao: orgao || undefined,
    urlTexto: raw.urlTextoCompleto
      ? String(raw.urlTextoCompleto)
      : undefined,
    municipio: raw.municipio ? String(raw.municipio) : undefined,
    uf: raw.uf ? String(raw.uf) : undefined,
    valorEstimado: extrairValor(resumo),
  }
}

function formatDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  return `${d}/${m}/${y}`
}

/**
 * Busca publicações do DOU por data e seção
 * Seção 3 = Contratos, Licitações e Avisos (mais relevante para oportunidades)
 */
export async function buscarDOU(params: {
  data?: string  // DD/MM/YYYY
  secao?: '1' | '2' | '3'
  pagina?: number
  tamanhoPagina?: number
}): Promise<DouAviso[]> {
  const { data, secao = '3', pagina = 1, tamanhoPagina = 50 } = params

  const dataStr = data ?? formatDate(new Date())
  const sp = new URLSearchParams({
    data: dataStr,
    secao,
    pagina: String(pagina),
    tamanhoDaPagina: String(tamanhoPagina),
  })

  const url = `${BASE_URL}/diario-oficial?${sp}`

  try {
    const res = await withTimeout(
      fetch(url, {
        headers: buildHeaders(),
        next: { revalidate: 3600 },
      }),
      15_000
    )
    if (!res.ok) return []
    const json = await res.json()
    const items: unknown[] = Array.isArray(json) ? json : (json.value ?? json.data ?? [])
    return items
      .map((r) => normalizarAviso(r as Record<string, unknown>))
  } catch {
    return []
  }
}

/**
 * Busca avisos de licitação de saúde nos últimos N dias
 * Cobre DOU Seção 3 (contratos) e Seção 1 (avisos e editais)
 */
export async function buscarAvisosLicitacaoSaude(diasRetroativos = 3): Promise<DouAviso[]> {
  const datas: string[] = []
  for (let i = 0; i < diasRetroativos; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    // Pula finais de semana (DOU não publica sábado e domingo)
    const diaSemana = d.getDay()
    if (diaSemana !== 0 && diaSemana !== 6) {
      datas.push(formatDate(d))
    }
  }

  if (datas.length === 0) return []

  const resultados = await Promise.allSettled([
    // Seção 3: Contratos e Licitações (avisos de licitação, resultados)
    ...datas.map((data) => buscarDOU({ data, secao: '3', tamanhoPagina: 100 })),
    // Seção 1: Atos normativos, portarias com verbas de saúde
    ...datas.slice(0, 1).map((data) => buscarDOU({ data, secao: '1', tamanhoPagina: 50 })),
  ])

  const todos: DouAviso[] = []
  for (const r of resultados) {
    if (r.status === 'fulfilled') todos.push(...r.value)
  }

  // Filtra somente saúde e deduplicam por id
  const seen = new Set<string>()
  return todos
    .filter((a) => isSaudeRelated(a.resumo + ' ' + a.titulo))
    .filter((a) => {
      if (seen.has(a.id)) return false
      seen.add(a.id)
      return true
    })
}

/**
 * Busca pré-editais (intenções de licitar) publicados no DOU
 * Intenção de Licitação (IL) é publicada antes do edital — sinal precoce
 */
export async function buscarPreEditaisSaude(): Promise<DouAviso[]> {
  const avisos = await buscarAvisosLicitacaoSaude(5)
  return avisos.filter((a) => {
    const tipo = (a.tipoPublicacao + a.titulo).toLowerCase()
    return (
      tipo.includes('intenção') ||
      tipo.includes('intencao') ||
      tipo.includes('aviso de licitação') ||
      tipo.includes('aviso de licitacao') ||
      tipo.includes('edital') ||
      tipo.includes('pregão') ||
      tipo.includes('pregao') ||
      tipo.includes('concorrência')
    )
  })
}
