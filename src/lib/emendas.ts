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

// Código da função Saúde no Portal (confirmado ao vivo: codigoFuncao=10 → só Saúde).
// Filtrar no SERVIDOR é essencial: sem isso, o /emendas devolve todas as funções
// misturadas (Educação, Defesa…) — a pág. 1 de um ano pode ter ZERO saúde, e o
// cap de páginas do chamador acabava puxando quase nenhuma emenda de saúde.
export const CODIGO_FUNCAO_SAUDE = '10'

export async function buscarEmendas(
  params: { ano?: number; pagina?: number; codigoFuncao?: string } = {},
): Promise<EmendaParlamentar[]> {
  const sp = new URLSearchParams({ pagina: String(params.pagina ?? 1) })
  if (params.ano) sp.set('ano', String(params.ano))
  if (params.codigoFuncao) sp.set('codigoFuncao', params.codigoFuncao)

  const res = await fetch(`${BASE_URL}/emendas?${sp}`, { headers: buildHeaders(), next: { revalidate: 7200 } })
  if (!res.ok) throw new Error(`Emendas ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/** Filtro EXATO: funcao === "Saúde" (confirmado no debug) — cinto e suspensório. */
function isSaude(e: EmendaParlamentar): boolean {
  const f = (e.funcao ?? '').trim().toLowerCase()
  return f === 'saúde' || f === 'saude'
}

// Puxa emendas de saúde de um ano com o filtro de função no SERVIDOR. Default alto
// (200 págs × 15 ≈ 3.000) porque há ~1.200+ emendas/ano. Usado no fallback ao vivo
// da rota; o caminho normal lê do cache do banco (ver src/lib/emendas-ingest.ts).
export async function buscarEmendasSaudeAno(ano: number, maxPaginas = 200): Promise<EmendaParlamentar[]> {
  const todas: EmendaParlamentar[] = []
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const lote = await buscarEmendas({ ano, pagina, codigoFuncao: CODIGO_FUNCAO_SAUDE })
    if (lote.length === 0) break
    todas.push(...lote.filter(isSaude))
    await new Promise((r) => setTimeout(r, 250))
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

// ── Detalhe da emenda (empenhos → favorecido / órgão / objeto) ───────────────
// A listagem de emendas é enxuta. O que está "incluso" (objeto, unidade
// contratada, órgão) vem dos documentos de empenho e do detalhe da despesa.

interface EmendaDocumentoRaw {
  id: number
  data: string
  fase: string
  codigoDocumento: string
  codigoDocumentoResumido: string
}

export interface EmendaEmpenho {
  documento: string
  data: string
  valor: string
  favorecido: string        // unidade/entidade contratada
  codigoFavorecido: string  // CNPJ/CPF
  ufFavorecido: string
  ug: string                // unidade gestora
  orgao: string
  orgaoSuperior: string
  observacao: string        // objeto: portaria, proposta, CNES…
  programa: string
  acao: string
  modalidade: string
  categoria: string         // "4 - DESPESAS DE CAPITAL"
  grupo: string             // "4 - Investimentos"
  elemento: string          // "42 - Auxílios", "52 - Equipamentos e material permanente"…
  subTitulo: string
  planoOrcamentario: string
}

/**
 * Para que a verba serve, em uma palavra.
 * É a pergunta que o vendedor faz primeiro: capital/investimento vira equipamento e
 * obra; custeio vira consumo, medicamento e serviço. Sai da dupla categoria+grupo da
 * despesa — em transferência fundo a fundo o `elemento` é genérico ("Auxílios") e
 * não serve para isso.
 */
export type NaturezaVerba = 'investimento' | 'custeio' | 'indefinido'

/**
 * "8535 - ESTRUTURACAO DE UNIDADES…" → "ESTRUTURACAO DE UNIDADES…"
 * O código nem sempre é numérico: as ações de custeio vêm como "2E90 - …", e uma
 * regex só de dígitos deixava o código sobrando no meio da frase na tela.
 */
export function semCodigo(s: string): string {
  return String(s ?? '').replace(/^\s*[A-Z0-9][A-Z0-9.]{1,7}\s*-\s*/i, '').trim()
}

export function naturezaDaVerba(categoria: string, grupo: string): NaturezaVerba {
  const t = `${categoria} ${grupo}`.toLowerCase()
  if (t.includes('capital') || t.includes('investimento')) return 'investimento'
  if (t.includes('corrente') || t.includes('custeio')) return 'custeio'
  return 'indefinido'
}

/** Leitura pronta do empenho mais relevante — o que a tela mostra sem ter de interpretar. */
export interface EmendaResumo {
  natureza: NaturezaVerba
  finalidade: string        // a ação orçamentária: "estruturação de unidades de atenção especializada"
  programa: string
  favorecido: string        // quem recebe o dinheiro — e quem vai licitar
  cnpjFavorecido: string
  /** Quantos favorecidos distintos aparecem nos empenhos detalhados. >1 em emenda de
   *  comissão, que é rateada entre municípios: aí `favorecido` é só o maior deles. */
  destinos: number
  transferencia: string     // "Transferências a Municípios - Fundo a Fundo"
  orgaoRepassador: string
  observacao: string
}

export interface EmendaDetalhe {
  codigoEmenda: string
  fases: { empenho: number; liquidacao: number; pagamento: number }
  empenhos: EmendaEmpenho[]
  /** null quando a emenda ainda não tem empenho detalhado no Portal. */
  resumo: EmendaResumo | null
}

async function buscarDocumentosEmenda(codigoEmenda: string): Promise<EmendaDocumentoRaw[]> {
  const res = await fetch(`${BASE_URL}/emendas/documentos/${codigoEmenda}?pagina=1`, {
    headers: buildHeaders(),
    next: { revalidate: 86400 },
  })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

async function buscarDetalheDespesa(codigoDocumento: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${BASE_URL}/despesas/documentos/${codigoDocumento}`, {
    headers: buildHeaders(),
    next: { revalidate: 86400 },
  })
  if (!res.ok) return null
  return res.json()
}

/**
 * Detalha uma emenda: resolve os empenhos e enriquece com favorecido (unidade
 * contratada), órgão/UG e o objeto (observação). Lazy — chamado sob demanda.
 */
export async function buscarDetalheEmenda(codigoEmenda: string, maxEmpenhos = 8): Promise<EmendaDetalhe> {
  const docs = await buscarDocumentosEmenda(codigoEmenda)
  const fases = {
    empenho: docs.filter((d) => d.fase === 'Empenho').length,
    liquidacao: docs.filter((d) => d.fase === 'Liquidação').length,
    pagamento: docs.filter((d) => d.fase === 'Pagamento').length,
  }

  const empenhoDocs = docs.filter((d) => d.fase === 'Empenho').slice(0, maxEmpenhos)
  const detalhes = await Promise.all(empenhoDocs.map((d) => buscarDetalheDespesa(d.codigoDocumento)))

  const empenhos: EmendaEmpenho[] = detalhes
    .filter((x): x is Record<string, unknown> => !!x)
    .map((x) => ({
      documento: String(x.documentoResumido ?? x.documento ?? ''),
      data: String(x.data ?? ''),
      valor: String(x.valor ?? ''),
      favorecido: String(x.nomeFavorecido ?? x.favorecido ?? ''),
      codigoFavorecido: String(x.codigoFavorecido ?? ''),
      ufFavorecido: String(x.ufFavorecido ?? ''),
      ug: String(x.ug ?? ''),
      orgao: String(x.orgao ?? ''),
      orgaoSuperior: String(x.orgaoSuperior ?? ''),
      observacao: String(x.observacao ?? ''),
      programa: String(x.programa ?? ''),
      acao: String(x.acao ?? ''),
      modalidade: String(x.modalidade ?? ''),
      categoria: String(x.categoria ?? ''),
      grupo: String(x.grupo ?? ''),
      elemento: String(x.elemento ?? ''),
      subTitulo: String(x.subTitulo ?? ''),
      planoOrcamentario: String(x.planoOrcamentario ?? ''),
    }))

  // O resumo sai do MAIOR empenho: quando a emenda foi fatiada, é ele que representa
  // o destino do dinheiro. Pegar o primeiro daria a fatia que por acaso veio na frente.
  const principal = empenhos.slice().sort((a, b) => parseValorBR(b.valor) - parseValorBR(a.valor))[0]
  const resumo: EmendaResumo | null = principal
    ? {
        natureza: naturezaDaVerba(principal.categoria, principal.grupo),
        finalidade: semCodigo(principal.acao),
        programa: semCodigo(principal.programa),
        favorecido: principal.favorecido || principal.ug,
        cnpjFavorecido: principal.codigoFavorecido,
        destinos: new Set(empenhos.map((e) => e.codigoFavorecido || e.favorecido).filter(Boolean)).size,
        transferencia: semCodigo(principal.modalidade),
        orgaoRepassador: principal.orgaoSuperior || principal.orgao,
        observacao: principal.observacao,
      }
    : null

  return { codigoEmenda, fases, empenhos, resumo }
}
