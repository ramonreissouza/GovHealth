// src/lib/emendas.ts — VERSÃO FINAL (calibrada com debug)
//
// Confirmado via debug: o campo 'funcao' usa o valor exato "Saúde" (com acento, S maiúsculo).
// As funções existentes no retorno incluem: Defesa nacional, Educação, Agricultura,
// Urbanismo, Saúde, Administração, Segurança pública, Gestão ambiental.

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados'

function buildHeaders() {
  const key = process.env.PORTAL_TRANSPARENCIA_API_KEY
  if (!key) throw new Error('PORTAL_TRANSPARENCIA_API_KEY não configurada')
  return { 'chave-api-dados': key, Accept: 'application/json' }
}

export interface EmendaParlamentar {
  codigoEmenda: string
  ano: number
  tipoEmenda: string
  autor: string
  numeroEmenda: string
  localidadeDoGasto: string
  funcao: string
  subfuncao: string
  valorEmpenhado: string
  valorLiquidado: string
  valorPago: string
}

export async function buscarEmendas(params: { ano?: number; pagina?: number } = {}): Promise<EmendaParlamentar[]> {
  const sp = new URLSearchParams({ pagina: String(params.pagina ?? 1) })
  if (params.ano) sp.set('ano', String(params.ano))

  const res = await fetch(`${BASE_URL}/emendas?${sp}`, { headers: buildHeaders(), next: { revalidate: 7200 } })
  if (!res.ok) throw new Error(`Emendas ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/** Filtro EXATO: funcao === "Saúde" (confirmado no debug) */
function isSaude(e: EmendaParlamentar): boolean {
  const f = (e.funcao ?? '').trim().toLowerCase()
  return f === 'saúde' || f === 'saude'
}

export async function buscarEmendasSaudeAno(ano: number, maxPaginas = 30): Promise<EmendaParlamentar[]> {
  const todas: EmendaParlamentar[] = []
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const lote = await buscarEmendas({ ano, pagina })
    if (lote.length === 0) break
    todas.push(...lote.filter(isSaude))
    await new Promise((r) => setTimeout(r, 700))
  }
  return todas
}

export function parseValorBR(valor: string | undefined): number {
  if (!valor) return 0
  return parseFloat(valor.replace(/\./g, '').replace(',', '.')) || 0
}

export function emendasQuentes(emendas: EmendaParlamentar[]): EmendaParlamentar[] {
  return emendas.filter((e) => {
    const emp = parseValorBR(e.valorEmpenhado)
    const pago = parseValorBR(e.valorPago)
    return emp > 100_000 && pago / emp < 0.5
  })
}

export async function buscarEmendasSaudeHistorico(
  anoInicial = 2023,
  onProgress?: (info: { ano: number; registros: number }) => void
): Promise<EmendaParlamentar[]> {
  const anoAtual = new Date().getFullYear()
  const todas: EmendaParlamentar[] = []
  for (let ano = anoInicial; ano <= anoAtual; ano++) {
    const e = await buscarEmendasSaudeAno(ano)
    todas.push(...e)
    onProgress?.({ ano, registros: e.length })
  }
  return todas
}
