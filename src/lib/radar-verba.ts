// src/lib/radar-verba.ts — Radar de Verba (item #3 do TOP10 v2 / PRD-radar-verba).
// Enquanto Vencedores olha o PASSADO (quem ganhou), o Radar olha o FUTURO: onde a
// verba de saúde existe (empenhada) mas ainda NÃO virou compra (não paga).
// A emenda é um LEAD A QUALIFICAR, não venda garantida — a linguagem da UI reflete isso.

import { parseValorBR, type EmendaParlamentar } from '@/lib/emendas'

export type Temperatura = 'quente' | 'morno' | 'frio'

export interface EmendaRadar {
  codigoEmenda: string
  numeroEmenda: string
  ano: number
  autor: string
  tipo: string
  subfuncao: string
  municipio: string
  uf: string
  empenhado: number
  pago: number
  disponivel: number          // empenhado − pago = "dinheiro em cima da mesa"
  percentualExecutado: number // 0-100
  score: number               // 0-100
  temperatura: Temperatura
  baixaRastreabilidade: boolean // emenda PIX / transferência especial
}

// Extrai a sigla da UF da localidade do gasto ("São Paulo (SP)", "MG", "Belo Campo/BA").
export function extrairUF(localidade: string | undefined): string {
  if (!localidade) return ''
  const m1 = localidade.match(/\(([A-Za-z]{2})\)/)
  if (m1) return m1[1].toUpperCase()
  const m2 = localidade.match(/[/-]\s*([A-Za-z]{2})\s*$/)
  if (m2) return m2[1].toUpperCase()
  const m3 = localidade.trim().match(/\b([A-Z]{2})\b\s*$/)
  return m3 ? m3[1].toUpperCase() : ''
}

// Emenda PIX / transferência especial: cai na conta do município sem vínculo a
// projeto — destino de baixa rastreabilidade (PRD seção 1).
export function eBaixaRastreabilidade(tipo: string | undefined): boolean {
  return /especial|\bpix\b|finalidade\s+n[ãa]o\s+definida/i.test(tipo ?? '')
}

// Afinidade da subfunção com VENDA DE EQUIPAMENTO (média/alta complexidade,
// atenção especializada e hospitalar tendem a envolver equipamento; básica/custeio menos).
function pontosSubfuncao(subfuncao: string | undefined): number {
  const s = (subfuncao ?? '').toLowerCase()
  if (/m[ée]dia e alta complexidade|alta complexidade|especializad|hospitalar|assist[êe]ncia hospitalar/.test(s)) return 12
  if (/aten[çc][ãa]o b[áa]sica|b[áa]sica|custeio|administra/.test(s)) return 3
  return 8
}

function pontosValor(disponivel: number): number {
  if (disponivel >= 1_000_000) return 25
  if (disponivel >= 500_000) return 18
  if (disponivel >= 200_000) return 12
  if (disponivel >= 50_000) return 6
  if (disponivel > 0) return 2
  return 0
}

/**
 * Score de temperatura 0-100 (AUXÍLIO de priorização, não previsão garantida).
 * Pesos simples e transparentes (PRD 3.2), somados e limitados a 100:
 *  - % não executado (disponível/empenhado)  → até 55 pts (o sinal principal)
 *  - valor disponível absoluto               → até 25 pts
 *  - afinidade da subfunção com equipamento   → até 12 pts
 *  - rastreabilidade do tipo (PIX pontua 0)   → até 8 pts
 * Sem verba empenhada não há oportunidade → score 0.
 */
export function calcularScore(empenhado: number, pago: number, subfuncao: string, tipo: string): number {
  if (empenhado <= 0) return 0
  const disponivel = Math.max(empenhado - pago, 0)
  const pctNaoExec = disponivel / empenhado
  const pontosNaoExec = Math.round(pctNaoExec * 55)
  const pontosRastreab = eBaixaRastreabilidade(tipo) ? 0 : 8
  const score = pontosNaoExec + pontosValor(disponivel) + pontosSubfuncao(subfuncao) + pontosRastreab
  return Math.max(0, Math.min(100, score))
}

export function temperaturaDe(score: number): Temperatura {
  if (score >= 70) return 'quente'
  if (score >= 45) return 'morno'
  return 'frio'
}

// Converte a emenda crua (Portal) na linha do radar, com score e disponível.
export function toEmendaRadar(e: EmendaParlamentar): EmendaRadar {
  const empenhado = parseValorBR(e.valorEmpenhado)
  const pago = parseValorBR(e.valorPago)
  const disponivel = Math.max(empenhado - pago, 0)
  const score = calcularScore(empenhado, pago, e.subfuncao, e.tipoEmenda)
  return {
    codigoEmenda: e.codigoEmenda,
    numeroEmenda: e.numeroEmenda,
    ano: e.ano,
    autor: e.autor,
    tipo: e.tipoEmenda,
    subfuncao: e.subfuncao,
    municipio: (e.localidadeDoGasto ?? '').replace(/\s*\([A-Za-z]{2}\)\s*$/, '').trim(),
    uf: extrairUF(e.localidadeDoGasto),
    empenhado,
    pago,
    disponivel,
    percentualExecutado: empenhado > 0 ? Math.round((pago / empenhado) * 100) : 0,
    score,
    temperatura: temperaturaDe(score),
    baixaRastreabilidade: eBaixaRastreabilidade(e.tipoEmenda),
  }
}
