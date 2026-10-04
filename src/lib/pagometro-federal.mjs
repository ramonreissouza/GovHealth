// src/lib/pagometro-federal.mjs — o cálculo do PAGÔMETRO FEDERAL, puro (sem banco, sem
// rede). Usado pela carga (scripts/ingest-pagometro-federal.mjs); testes em
// scripts/pagometro.teste.mjs.
//
// FONTE: os arquivos diários de despesa do Portal da Transparência (CGU), um ZIP por dia
// em dadosabertos-download.cgu.gov.br, públicos e sem chave. Cada dia traz as
// liquidações e os pagamentos, e cada um aponta o EMPENHO que movimenta. Não existe
// ligação direta "este pagamento quita aquela liquidação".
//
// MÉTODO: por empenho, o pagamento quita a liquidação mais antiga ainda em aberto (fila,
// primeiro a entrar, primeiro a sair). Os dias de cada pedaço quitado são a diferença
// entre a data do pagamento e a da liquidação; a média é ponderada pelo valor. Estorno
// de liquidação (valor negativo) tira do fim da fila. Pagamento sem liquidação conhecida
// (liquidada antes do início da série, ou fora do arquivo) não entra na média e é
// contado à parte ("sem liquidação"), para a tela não esconder a cobertura.
//
// QUEM PAGA: a Unidade Gestora (UG). No governo federal ela é a mesma UASG que o PNCP
// manda em unidadeOrgao.codigoUnidade (conferido em 04/10/2026: Ministério da Saúde
// 250052 → Instituto Nacional do Câncer; 150247 → Complexo Hospitalar da UFBA).
//
// Medido na sondagem (setembro/2026): ver docs no PR da Fase 2.

import { ehFornecedor } from './pagometro-calculo.mjs'

/** CSV do Portal: ';' separa, tudo entre aspas, "" escapa aspas. Gera arrays de campos. */
export function* linhasCsv(texto) {
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false }
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ';') { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo.replace(/\r$/, '')); yield linha; linha = []; campo = '' }
    else campo += c
  }
  if (campo || linha.length) { linha.push(campo); yield linha }
}

/** Linhas como objetos pelo cabeçalho. Linha curta (quebrada) é descartada. */
export function lerCsv(texto) {
  const it = linhasCsv(texto)
  const cab = it.next().value ?? []
  const out = []
  for (const l of it) {
    if (l.length < cab.length) continue
    const o = {}
    for (let j = 0; j < cab.length; j++) o[cab[j]] = l[j]
    out.push(o)
  }
  return out
}

/** "1.234,56" → 1234.56 */
export const numBR = (s) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0
/** "30/09/2026" → "2026-09-30" */
export const dataBR = (s) => { const m = String(s ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const diasEntre = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000))

/**
 * Um dia de arquivos → liquidações e pagamentos de FORNECEDOR (pagometro-calculo:
 * ehFornecedor), por empenho, e o nome de cada UG vista.
 * @param {{ liquidacao: string, liquidacaoEmpenhos: string, pagamento: string, pagamentoEmpenhos: string }} csv
 */
export function eventosDoDia(csv) {
  const ugs = new Map()
  const cab = (tab) => {
    const m = new Map()
    for (const r of lerCsv(tab)) {
      const cod = r['Código Liquidação'] ?? r['Código Pagamento']
      const ug = r['Código Unidade Gestora']
      m.set(cod, { data: dataBR(r['Data Emissão']), ug })
      if (ug && !ugs.has(ug)) ugs.set(ug, { nome: r['Unidade Gestora'] ?? null, orgao: r['Órgão'] ?? null })
    }
    return m
  }
  const liqCab = cab(csv.liquidacao), pagCab = cab(csv.pagamento)
  const eventos = (tab, cabs, chave, colValor) => {
    const out = []
    for (const r of lerCsv(tab)) {
      if (!ehFornecedor(r['Código Natureza Despesa Completa'])) continue
      const c = cabs.get(r[chave])
      if (!c?.data || !c.ug) continue
      const valor = numBR(r[colValor])
      if (valor) out.push({ empenho: r['Código Empenho'], ug: c.ug, data: c.data, valor })
    }
    return out
  }
  return {
    liqs: eventos(csv.liquidacaoEmpenhos, liqCab, 'Código Liquidação', 'Valor Liquidado (R$)'),
    pags: eventos(csv.pagamentoEmpenhos, pagCab, 'Código Pagamento', 'Valor Pago (R$)'),
    ugs,
  }
}

/**
 * Aplica um dia sobre as filas em aberto. `filas`: Map empenho → [{ data, saldo, ug }]
 * em ordem de chegada; é ALTERADO. Liquidações do dia entram antes dos pagamentos do
 * mesmo dia (paga-se no dia em que se liquida). Devolve o pago casado por UG e mês do
 * pagamento.
 */
export function aplicarDia(filas, { liqs, pags }) {
  for (const l of liqs) {
    const fila = filas.get(l.empenho) ?? []
    if (l.valor > 0) fila.push({ data: l.data, saldo: l.valor, ug: l.ug })
    else {
      let resto = -l.valor
      while (resto > 0.005 && fila.length) {
        const u = fila[fila.length - 1]; const t = Math.min(u.saldo, resto)
        u.saldo -= t; resto -= t
        if (u.saldo <= 0.005) fila.pop()
      }
    }
    if (fila.length) filas.set(l.empenho, fila); else filas.delete(l.empenho)
  }
  const mensal = new Map()
  for (const p of pags) {
    if (p.valor <= 0) continue // estorno de pagamento: não reabre a fila (raro; fica fora)
    const chave = `${p.ug}|${p.data.slice(0, 7)}`
    const m = mensal.get(chave) ?? { ug: p.ug, ano: +p.data.slice(0, 4), mes: +p.data.slice(5, 7), pago: 0, pagoXdias: 0, semLiquidacao: 0, pagamentos: 0 }
    const fila = filas.get(p.empenho) ?? []
    let v = p.valor
    while (v > 0.005 && fila.length) {
      const l = fila[0]; const t = Math.min(l.saldo, v)
      m.pago += t; m.pagoXdias += t * diasEntre(l.data, p.data)
      l.saldo -= t; v -= t
      if (l.saldo <= 0.005) fila.shift()
    }
    if (v > 0.005) m.semLiquidacao += v
    m.pagamentos++
    mensal.set(chave, m)
    if (fila.length) filas.set(p.empenho, fila); else filas.delete(p.empenho)
  }
  return mensal
}

/** Abaixo disto, os dias da UG são ruído. */
export const MIN_PAGO_FEDERAL = 200_000
export const MIN_PAGAMENTOS_FEDERAL = 20
/**
 * Os primeiros dias da série não têm as liquidações de antes do começo: o pagamento
 * delas fica "sem liquidação" e só os de prazo curto casam, puxando a média para baixo.
 * Meses que começam antes de AQUECIMENTO_DIAS depois do início da série ficam fora.
 */
export const AQUECIMENTO_DIAS = 90

/**
 * Resumo de uma UG a partir dos meses dela.
 * @param {{ ano: number, mes: number, pago: number, pagoXdias: number, semLiquidacao: number, pagamentos: number }[]} meses
 * @param {{ inicioSerie: string, janelaMeses?: number }} op  inicioSerie = 1º dia processado (AAAA-MM-DD)
 */
export function resumirUg(meses, op) {
  const corte = new Date(Date.parse(op.inicioSerie) + AQUECIMENTO_DIAS * 86_400_000).toISOString().slice(0, 7)
  const validos = meses
    .filter((m) => `${m.ano}-${String(m.mes).padStart(2, '0')}` >= corte)
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes)
    .slice(-(op.janelaMeses ?? 12))
  const s = validos.reduce((a, m) => ({
    pago: a.pago + m.pago, px: a.px + m.pagoXdias, sem: a.sem + m.semLiquidacao, n: a.n + m.pagamentos,
  }), { pago: 0, px: 0, sem: 0, n: 0 })
  const fmt = (m) => (m ? `${m.ano}-${String(m.mes).padStart(2, '0')}-01` : null)
  const suficiente = s.pago >= MIN_PAGO_FEDERAL && s.n >= MIN_PAGAMENTOS_FEDERAL
  return {
    dias: suficiente ? Math.round((s.px / s.pago) * 10) / 10 : null,
    pago: s.pago,
    pagamentos: s.n,
    /** Fração do pago que casou com uma liquidação conhecida. */
    casado: s.pago + s.sem > 0 ? s.pago / (s.pago + s.sem) : null,
    meses: validos.length,
    inicio: fmt(validos[0]),
    fim: fmt(validos[validos.length - 1]),
  }
}
