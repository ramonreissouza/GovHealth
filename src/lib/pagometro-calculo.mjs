// src/lib/pagometro-calculo.mjs — o cálculo do PAGÔMETRO, num lugar só. Módulo puro (sem
// banco, sem rede), usado pela carga (scripts/ingest-pagometro.mjs) e pelo app
// (src/lib/pagometro.ts). Testes em scripts/pagometro.teste.mjs.
//
// O QUE ELE MEDE (e o que não mede)
//
// Quantos dias, em média, um ente público leva para pagar uma conta DEPOIS de
// reconhecê-la (a liquidação). Fonte: a Matriz de Saldos Contábeis (MSC) que todo
// município e estado entrega todo mês ao Tesouro (Siconfi). Duas contas do PCASP:
//
//   6.2.2.1.3.03  crédito empenhado liquidado A PAGAR  (estoque no fim do mês)
//   6.2.2.1.3.04  crédito empenhado liquidado PAGO     (acumulado no ano)
//
//   dias ≈ estoque médio a pagar ÷ (pago no período ÷ dias do período)
//
// Não mede o tempo ANTES da liquidação — o órgão que demora a atestar a entrega não
// aparece aqui. Por isso a tela diz "depois de reconhecer a nota", nunca "paga em".
//
// Medido na sondagem (02–04/10/2026, jan–jun/2026, só fornecedor): Westfália/RS 7,8 dias
// (Saúde 10,5); Salvador/BA 3,2 dias (Saúde 8,7). Com a folha junto, Salvador dava 2,2:
// salário sai no dia e escondia o atraso de fornecedor. Daí o filtro abaixo.

/** Compra de fornecedor: aplicação direta (modalidade 90) nos elementos que um vendedor
 *  de saúde fatura — 30 material de consumo, 32 material de distribuição gratuita,
 *  39 serviços de terceiros PJ, 40 serviços de TIC, 52 equipamentos. */
export const ELEMENTOS_FORNECEDOR = new Set(['30', '32', '39', '40', '52'])

const CONTA_A_PAGAR = '6221303'
const CONTA_PAGO = '6221304'

/** @param {string | null | undefined} nd natureza da despesa, ex.: "33903000" */
export function ehFornecedor(nd) {
  const d = String(nd ?? '').replace(/\D/g, '')
  return d.length >= 6 && d.slice(2, 4) === '90' && ELEMENTOS_FORNECEDOR.has(d.slice(4, 6))
}

/**
 * Soma as linhas da MSC (classe 6, saldo final) de UM ente e UM mês.
 * @param {{ conta_contabil: string|number, natureza_despesa?: string|null, funcao?: string|number|null, valor: number|string, natureza_conta?: string }[]} itens
 */
export function somarMsc(itens) {
  const r = { aPagar: 0, pagoAcumulado: 0, aPagarSaude: 0, pagoAcumuladoSaude: 0, linhas: itens.length }
  for (const i of itens) {
    const conta = String(i.conta_contabil ?? '')
    const ehAPagar = conta.startsWith(CONTA_A_PAGAR)
    if (!ehAPagar && !conta.startsWith(CONTA_PAGO)) continue
    if (!ehFornecedor(i.natureza_despesa)) continue
    // Contas de natureza credora: saldo devedor é estorno e entra negativo.
    const v = (Number(i.valor) || 0) * (i.natureza_conta === 'D' ? -1 : 1)
    const saude = String(i.funcao ?? '').replace(/^0+/, '') === '10'
    if (ehAPagar) { r.aPagar += v; if (saude) r.aPagarSaude += v }
    else { r.pagoAcumulado += v; if (saude) r.pagoAcumuladoSaude += v }
  }
  return r
}

const diasNoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate()

/** Abaixo disto o número de dias é ruído, não comportamento. */
export const MIN_MESES = 3
export const MIN_PAGO_SAUDE = 50_000

/**
 * Dias estimados a partir da série mensal de UM ente. O "pago no mês" sai da diferença
 * do acumulado: em janeiro é o próprio acumulado (o ano recomeça); um mês sem o
 * anterior na série não tem fluxo conhecido e fica de fora — inventar o fluxo
 * distorceria a média para o lado que o buraco caísse.
 *
 * @param {{ ano: number, mes: number, aPagar: number, pagoAcumulado: number, aPagarSaude: number, pagoAcumuladoSaude: number }[]} serie
 * @param {{ janelaMeses?: number }} [op]
 */
export function resumirDias(serie, op = {}) {
  const janela = op.janelaMeses ?? 12
  const ord = [...serie].sort((a, b) => a.ano - b.ano || a.mes - b.mes)
  const uteis = []
  for (let k = 0; k < ord.length; k++) {
    const m = ord[k]
    const ant = ord[k - 1]
    let pago, pagoSaude
    if (m.mes === 1) { pago = m.pagoAcumulado; pagoSaude = m.pagoAcumuladoSaude }
    else if (ant && ant.ano === m.ano && ant.mes === m.mes - 1) {
      pago = m.pagoAcumulado - ant.pagoAcumulado
      pagoSaude = m.pagoAcumuladoSaude - ant.pagoAcumuladoSaude
    } else continue
    uteis.push({ ...m, pago: Math.max(0, pago), pagoSaude: Math.max(0, pagoSaude), dias: diasNoMes(m.ano, m.mes) })
  }
  const ult = uteis.slice(-janela)
  const dias = (estoque, fluxo) => {
    const n = ult.length
    const pagoTotal = ult.reduce((s, m) => s + fluxo(m), 0)
    if (n < MIN_MESES || pagoTotal <= 0) return { dias: null, pago: pagoTotal }
    const estoqueMedio = ult.reduce((s, m) => s + Math.max(0, estoque(m)), 0) / n
    const pagoDia = pagoTotal / ult.reduce((s, m) => s + m.dias, 0)
    return { dias: Math.round((estoqueMedio / pagoDia) * 10) / 10, pago: pagoTotal }
  }
  const geral = dias((m) => m.aPagar, (m) => m.pago)
  const saude = dias((m) => m.aPagarSaude, (m) => m.pagoSaude)
  const fmt = (m) => (m ? `${m.ano}-${String(m.mes).padStart(2, '0')}-01` : null)
  return {
    dias: geral.dias,
    diasSaude: saude.pago >= MIN_PAGO_SAUDE ? saude.dias : null,
    meses: ult.length,
    inicio: fmt(ult[0]),
    fim: fmt(ult[ult.length - 1]),
    pagoPeriodo: geral.pago,
    pagoPeriodoSaude: saude.pago,
  }
}

/** Verde até 15 dias, âmbar até 45, vermelho acima. */
export function faixaDias(dias) {
  if (dias == null) return null
  return dias <= 15 ? 'rapido' : dias <= 45 ? 'medio' : 'lento'
}

/** Chave canônica de município. DEVE ser igual a normalizeKey de src/lib/text.ts: a
 *  carga grava com esta e o app consulta com aquela (teste em pagometro.teste.mjs). */
export function normalizeKey(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

const ESTADOS = 'ACRE|ALAGOAS|AMAPA|AMAZONAS|BAHIA|CEARA|ESPIRITO SANTO|GOIAS|MARANHAO|MATO GROSSO( DO SUL)?|MINAS GERAIS|PARA|PARAIBA|PARANA|PERNAMBUCO|PIAUI|RIO DE JANEIRO|RIO GRANDE DO NORTE|RIO GRANDE DO SUL|RONDONIA|RORAIMA|SANTA CATARINA|SAO PAULO|SERGIPE|TOCANTINS'
// Abreviações com ponto ("CONS.", "EST.DE SP") ficam fora do \b final: depois do ponto
// não há fronteira de palavra quando vem espaço.
const RE_OUTRO = /\b(CONSORCIO|INTERMUNICIPAL|CONSELHO (REGIONAL|FEDERAL))\b|\bCONS\./
const RE_MUNICIPAL = /\b(MUNICIPIO|MUNICIPAL|MUNICIPAIS|PREFEITURA|MUN)\b/
const RE_FEDERAL = new RegExp('\\b(' + [
  'FEDERAL', 'NACIONAL', 'UNIAO', 'MINISTERIO D[AOE]', 'EBSERH', 'EMPRESA BRASILEIRA', 'BANCO CENTRAL',
  'TRIBUNAL SUPERIOR', 'SUPERIOR TRIBUNAL', 'TRIBUNAL REGIONAL', 'JUSTICA DO TRABALHO', 'JUSTICA ELEITORAL',
  'COMANDO D[AOE]', 'EXERCITO', 'MARINHA', 'AERONAUTICA', 'FUNDACAO OSWALDO CRUZ', 'FIOCRUZ', 'HOSPITAL UNIVERSITARIO',
].join('|') + ')\\b')
const RE_ESTADUAL = new RegExp('\\b(' + [
  'GOVERNO DO ESTADO', 'SECRETARIA D[AEO] ESTADO', 'ESTADUAL', 'ESTADO D[AEO]', 'DISTRITO FEDERAL',
  'POLICIA MILITAR', 'CORPO DE BOMBEIROS', 'TRIBUNAL DE JUSTICA', 'ASSEMBLEIA LEGISLATIVA',
].join('|') + ')\\b|\\bEST\\.|^(' + ESTADOS + ') SECRETARIA\\b')

/**
 * Quem paga a compra: a prefeitura, o estado ou a União. O PNCP não traz a esfera de
 * forma confiável na nossa base (370 mil contratações com `esfera` nula), e uma compra
 * da Secretaria de Estado da Saúde feita em Salvador é paga pelo ESTADO, não pela
 * prefeitura. Federal fica sem Pagômetro nesta fase (vem do Portal da Transparência).
 *
 * Sem marca reconhecível, 'outro' — e o selo some. Medido em 04/10/2026: 13% das
 * contratações (UEL, Unicamp, USP, Banco Central, TST…) não têm marca de prefeitura no
 * nome; o padrão antigo ('municipio') dava a elas o prazo da cidade onde ficam.
 * @param {string | null | undefined} orgao razão social do órgão comprador
 * @returns {'municipio' | 'estado' | 'federal' | 'outro'}
 */
export function classificarPagador(orgao) {
  const o = normalizeKey(orgao).replace(/\s+/g, ' ')
  // Consórcio e afins têm caixa próprio: não é a prefeitura nem o estado.
  if (RE_OUTRO.test(o)) return 'outro'
  // Marca municipal vence: "PREFEITURA MUNICIPAL DE X - ESTADO DE SP" é da prefeitura.
  if (RE_MUNICIPAL.test(o)) return 'municipio'
  // Ministério Público estadual antes do federal: "MINISTERIO PUBLICO DO ESTADO DA BAHIA".
  if (/\bMINISTERIO PUBLICO D[OE] ESTADO\b/.test(o)) return 'estado'
  // "UNIVERSIDADE FEDERAL DO ESTADO DO RIO DE JANEIRO" é federal: federal antes do estado,
  // com o Distrito Federal tirado da frente.
  if (RE_FEDERAL.test(o.replace(/DISTRITO FEDERAL/g, ''))) return 'federal'
  if (RE_ESTADUAL.test(o)) return 'estado'
  return 'outro'
}

/**
 * Quem paga, com a esfera do PNCP (orgaoEntidade.esferaId) quando ela veio: ela é dita
 * pelo próprio órgão e vence o nome. Medido em 04/10/2026: o Grupo Hospitalar Conceição
 * (federal) e 183 compras federais em 90 dias não tinham nome de federal. Sem esfera (as
 * contratações anteriores à coluna) ou 'N' (não se aplica), vale o nome.
 * @param {string | null | undefined} orgao
 * @param {string | null | undefined} esfera  'F' | 'E' | 'M' | 'D' | 'N'
 * @returns {'municipio' | 'estado' | 'federal' | 'outro'}
 */
export function pagadorDe(orgao, esfera) {
  const e = String(esfera ?? '').trim().toUpperCase()
  if (e === 'F') return 'federal'
  if (e === 'E' || e === 'D') return 'estado'
  if (e === 'M') return 'municipio'
  return classificarPagador(orgao)
}
