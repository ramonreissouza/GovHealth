// scripts/radar/ciclo-cobertura.mjs — quando um conector que lê em LOTES pode dizer
// "verifiquei tudo".
//
// O Compras.gov.br público lê no máximo 5 compras por rodada (cada uma custa navegador,
// e às vezes um CAPTCHA resolvido por gente). O rodízio garante que a lista inteira é
// percorrida em voltas. Mas `verificado_em` é uma AFIRMAÇÃO sobre a lista inteira — a
// tela usa ele para dizer "sem novidades desde X" — e ler 5 de 12 não autoriza isso.
//
// Antes, o conector só dava `ok` quando `lidos === processos.length`, e com 6 compras ou
// mais isso nunca acontecia: a saúde nunca ficava verde (revisão da #39). Trocar para
// "ok a cada lote limpo" seria o erro oposto: afirmar a lista toda tendo lido um terço.
//
// A regra daqui:
//   - cada rodada soma as posições que consumiu na volta corrente;
//   - quando a soma cobre a lista, a volta FECHA;
//   - se TODOS os lotes da volta foram limpos, `verificado_em` avança para o INÍCIO da
//     volta — o instante mais antigo em que alguém olhou alguma compra dela, que é o
//     máximo que se pode afirmar da lista inteira;
//   - um lote sujo (falha, parcial, recusa) contamina a volta: ela fecha sem avançar
//     `verificado_em`, e a próxima começa limpa.
//
// Puro de propósito; quem lê e grava o estado é o run.mjs (etl_checkpoint).

/** @typedef {{ acumulado: number, inicio: string | null, limpa: boolean }} EstadoVolta */

/** Estado de uma volta que ainda não começou. */
export const VOLTA_NOVA = Object.freeze({ acumulado: 0, inicio: null, limpa: true })

/**
 * @param {EstadoVolta} estado     o que estava gravado (ou VOLTA_NOVA)
 * @param {{ consumidos: number, total: number, loteLimpo: boolean, inicioLote: string }} lote
 * @returns {{ estado: EstadoVolta, fechou: boolean, verificadoEm: string | null }}
 */
export function avancarVolta(estado, { consumidos, total, loteLimpo, inicioLote }) {
  const e = estado && estado.acumulado > 0 ? estado : { ...VOLTA_NOVA, inicio: inicioLote }
  const n = Number(consumidos)
  const t = Number(total)
  // Sem número confiável, não se afirma nada — nem se avança a volta.
  if (!Number.isFinite(n) || n < 0 || !Number.isFinite(t) || t <= 0) {
    return { estado: e.acumulado > 0 ? e : VOLTA_NOVA, fechou: false, verificadoEm: null }
  }
  const acumulado = e.acumulado + n
  const limpa = e.limpa && !!loteLimpo
  const inicio = e.inicio ?? inicioLote
  if (acumulado >= t) {
    return { estado: VOLTA_NOVA, fechou: true, verificadoEm: limpa ? inicio : null }
  }
  return { estado: { acumulado, inicio, limpa }, fechou: false, verificadoEm: null }
}

/** Chaves em `etl_checkpoint`: uma guarda o acumulado, a outra o início e se está limpa. */
export function chavesVolta(portalId, titularId) {
  return {
    acumulado: `radar:volta:${portalId}:${titularId}`,
    inicio: `radar:volta-inicio:${portalId}:${titularId}`,
  }
}

/** Frase para o log: sem ela, "ok" sem `verificado_em` novo parece defeito. */
export function explicarVolta(r, total) {
  if (r.fechou) return r.verificadoEm ? 'volta completa: lista inteira verificada' : 'volta completa, mas com lote não lido — verificação não avança'
  return `volta em andamento: ${r.estado.acumulado} de ${total}${r.estado.limpa ? '' : ' (já com lote não lido)'}`
}
