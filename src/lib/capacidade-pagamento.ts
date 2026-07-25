// src/lib/capacidade-pagamento.ts — CAPACIDADE DE PAGAMENTO da instituição pagadora.
//
// Fonte única do fator "capacidade de pagamento" que entra como sub-score aditivo
// ponderado no Opportunity Score (score-engine) e no Radar de Verba (radar-verba).
//
// Híbrido (decisão do produto):
//  - Órgão PÚBLICO (município/estado): CAPAG do Tesouro Nacional — nota A/B/C/D
//    (gratuita, oficial). Tabela `capag`, populada por scripts/ingest-capag.mjs.
//  - Entidade PRIVADA/filantrópica (Santa Casa etc): Serasa — atrás de SERASA_API_KEY
//    (fase 2). Sem a chave, degrada para "sem dado" (não quebra o score).
//
// A→100, B→70, C→40, D→10. Sem dado (federal/União, ente não encontrado) = NEUTRO,
// para não penalizar nem inflar leads sem informação.

import { query } from '@/lib/db'
import { normalizeKey } from '@/lib/text'
import { getCached, setCached, TTL } from '@/lib/server-cache'

export type NotaCapag = 'A' | 'B' | 'C' | 'D'
export type FonteCapacidade = 'capag' | 'serasa' | 'na'

export interface CapacidadePagamento {
  fonte: FonteCapacidade
  nota: NotaCapag | null // letra A/B/C/D (CAPAG) — Serasa preenche a partir da faixa
  score: number          // 0-100 (entra no cálculo ponderado)
  label: string          // rótulo curto p/ UI (ex.: "CAPAG A", "sem dado")
  detalhe?: string        // tooltip opcional
}

// Score neutro para ente sem classificação (federal/União ou não encontrado). Fica
// levemente acima do meio: "desconhecido" não deve derrubar nem turbinar o lead.
export const NEUTRO_SCORE = 60

const SCORE_POR_NOTA: Record<NotaCapag, number> = { A: 100, B: 70, C: 40, D: 10 }

// Nome do estado (normalizado sem acento/maiúsculo) → sigla. Emendas estaduais vêm
// como "PARANÁ (UF)" ou só "PARANÁ"; mapeamos para resolver a CAPAG estadual.
const ESTADOS_UF: Record<string, string> = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE',
  'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA',
  'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'MINAS GERAIS': 'MG', PARA: 'PA',
  PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO', RORAIMA: 'RR',
  'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO',
}

export function scoreDaNota(nota: NotaCapag): number {
  return SCORE_POR_NOTA[nota] ?? NEUTRO_SCORE
}

export function capacidadeNeutra(motivo = 'sem dado'): CapacidadePagamento {
  return { fonte: 'na', nota: null, score: NEUTRO_SCORE, label: motivo }
}

function toNota(v: string | null | undefined): NotaCapag | null {
  const s = (v ?? '').trim().toUpperCase().charAt(0)
  return s === 'A' || s === 'B' || s === 'C' || s === 'D' ? (s as NotaCapag) : null
}

// ── Índice CAPAG (carregado em lote para pontuar muitos leads sem N queries) ─────

interface CapagRow { ente_tipo: string; uf: string; municipio_key: string; nota: string | null }

export class IndiceCapag {
  private estados = new Map<string, NotaCapag>()          // uf → nota
  private municipios = new Map<string, NotaCapag>()        // `${uf}:${key}` → nota

  add(r: CapagRow) {
    const nota = toNota(r.nota)
    if (!nota) return
    if (r.ente_tipo === 'estado') this.estados.set(r.uf, nota)
    else this.municipios.set(`${r.uf}:${r.municipio_key}`, nota)
  }

  // Resolve a partir da "localidade do gasto" crua do Portal (emendas). Trata os
  // marcadores do governo: "Cidade (SP)" = municipal; "PARANÁ (UF)" ou nome de estado
  // = estadual; "MÚLTIPLO"/"NACIONAL" = sem ente definido → neutro.
  resolveLocalidade(localidade: string | null | undefined): CapacidadePagamento {
    const loc = (localidade ?? '').trim()
    if (!loc || /m[úu]ltiplo|nacional|exterior/i.test(loc)) return capacidadeNeutra('sem ente')
    // Sufixo de UF em qualquer formato do Portal: "Cidade - PB", "Embu/SP", "Bahia (UF)".
    const sigla = loc.match(/[([/-]\s*([A-Za-z]{2})\)?\s*$/)?.[1]?.toUpperCase()
    const nome = loc.replace(/\s*[([/-]\s*[A-Za-z]{2}\)?\s*$/, '').trim()
    // "(UF)" é o marcador de nível ESTADUAL do Portal → resolve pela nota do estado.
    if (sigla === 'UF') {
      const uf = ESTADOS_UF[normalizeKey(nome)]
      return uf ? this.resolvePublico(uf, null) : capacidadeNeutra('sem ente')
    }
    // Sigla real ("- PB"/"(SP)") → municipal (com fallback estadual dentro de resolvePublico).
    if (sigla) return this.resolvePublico(sigla, nome)
    // Sem sigla: o nome pode ser um estado ("PARANÁ"); senão, sem ente.
    const uf = ESTADOS_UF[normalizeKey(nome)]
    return uf ? this.resolvePublico(uf, null) : capacidadeNeutra('sem ente')
  }

  // Resolve a capacidade de um ente PÚBLICO: tenta o município; se não achar (ou o
  // lead não tiver município), cai para a nota do estado; senão, neutro.
  resolvePublico(uf: string | null | undefined, municipio: string | null | undefined): CapacidadePagamento {
    const UF = (uf ?? '').trim().toUpperCase()
    if (!UF) return capacidadeNeutra()
    const key = municipio ? normalizeKey(municipio) : ''
    const mun = key ? this.municipios.get(`${UF}:${key}`) : undefined
    if (mun) return { fonte: 'capag', nota: mun, score: scoreDaNota(mun), label: `CAPAG ${mun}`, detalhe: `Município ${municipio}/${UF}` }
    const est = this.estados.get(UF)
    if (est) return { fonte: 'capag', nota: est, score: scoreDaNota(est), label: `CAPAG ${est}`, detalhe: `Estado ${UF} (município sem classificação própria)` }
    return capacidadeNeutra('sem CAPAG')
  }
}

// Carrega o índice CAPAG para o conjunto de UFs pedido (ou todas, se vazio). Cacheado
// em memória (CAPAG muda ~1x/ano) para não reconsultar o banco a cada request.
export async function carregarIndiceCapag(ufs?: string[]): Promise<IndiceCapag> {
  const chave = `capag:idx:${ufs?.length ? [...ufs].map((u) => u.toUpperCase()).sort().join(',') : 'all'}`
  const cached = getCached<IndiceCapag>(chave)
  if (cached) return cached

  const idx = new IndiceCapag()
  try {
    const rows = ufs?.length
      ? await query<CapagRow>('SELECT ente_tipo, uf, municipio_key, nota FROM capag WHERE uf = ANY($1::text[])', [ufs.map((u) => u.toUpperCase())])
      : await query<CapagRow>('SELECT ente_tipo, uf, municipio_key, nota FROM capag')
    for (const r of rows) idx.add(r)
    setCached(chave, idx, TTL.LONG)
  } catch (e) {
    // Sem a tabela/migração ainda: índice vazio → tudo neutro (score não quebra).
    console.warn('[capacidade-pagamento] CAPAG indisponível:', e instanceof Error ? e.message : e)
  }
  return idx
}

// ── Comportamento de pagamento (Item 1 — portais estaduais; piloto BA) ────────────
// Atividade real de disbursos por órgão (valor pago 12m + nº de pagamentos), da ordem
// cronológica. Sinal de que o pagador efetivamente paga (complementa a nota CAPAG).

export interface ComportamentoPagamento { valorPago12m: number; qtdPagamentos: number; orgaoNome: string }

export async function carregarComportamentoPagamento(uf: string): Promise<Map<string, ComportamentoPagamento>> {
  const chave = `pagcomport:${uf.toUpperCase()}`
  const cached = getCached<Map<string, ComportamentoPagamento>>(chave)
  if (cached) return cached
  const m = new Map<string, ComportamentoPagamento>()
  try {
    const rows = await query<{ orgao_key: string; orgao_nome: string; valor_pago_12m: number; qtd_fila: number }>(
      'SELECT orgao_key, orgao_nome, valor_pago_12m::float8 AS valor_pago_12m, qtd_fila FROM pagamento_comportamento WHERE uf = $1',
      [uf.toUpperCase()],
    )
    for (const r of rows) m.set(r.orgao_key, { valorPago12m: Number(r.valor_pago_12m) || 0, qtdPagamentos: r.qtd_fila || 0, orgaoNome: r.orgao_nome })
    setCached(chave, m, TTL.LONG)
  } catch (e) {
    console.warn('[comportamento-pagamento] indisponível:', e instanceof Error ? e.message : e)
  }
  return m
}

// Chave de órgão p/ casar com pagamento_comportamento (mesma normalização do ingest).
export function orgaoKey(nome: string): string { return normalizeKey(nome) }

// ── Serasa (Fase 2 — entes privados/filantrópicos) ───────────────────────────────
// Atrás de SERASA_API_KEY. Sem a chave, retorna neutro (feature inerte até o contrato
// e a validação com o financeiro). O mapeamento score→nota segue as faixas usuais do
// Serasa (0-1000). Mantido isolado para trocar o endpoint quando as credenciais vierem.

export function serasaHabilitado(): boolean {
  return !!process.env.SERASA_API_KEY
}

function notaDeScoreSerasa(score0a1000: number): NotaCapag {
  if (score0a1000 >= 700) return 'A'
  if (score0a1000 >= 500) return 'B'
  if (score0a1000 >= 300) return 'C'
  return 'D'
}

export async function capacidadeSerasa(cnpj: string | null | undefined): Promise<CapacidadePagamento> {
  if (!serasaHabilitado() || !cnpj) return capacidadeNeutra('Serasa não configurado')
  try {
    const base = process.env.SERASA_API_URL || 'https://api.serasaexperian.com.br'
    const res = await fetch(`${base}/credit-services/business-information-report/v1/reports?document=${encodeURIComponent(cnpj)}`, {
      headers: { Authorization: `Bearer ${process.env.SERASA_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return capacidadeNeutra('Serasa indisponível')
    const j = (await res.json()) as { score?: number; concentonScore?: number }
    const raw = Number(j.score ?? j.concentonScore)
    if (!Number.isFinite(raw)) return capacidadeNeutra('Serasa sem score')
    const nota = notaDeScoreSerasa(raw)
    return { fonte: 'serasa', nota, score: scoreDaNota(nota), label: `Serasa ${nota}`, detalhe: `Score Serasa ${Math.round(raw)}` }
  } catch (e) {
    return capacidadeNeutra('Serasa erro')
  }
}
