// scripts/pncp-breaker.mjs — DISJUNTOR DO ENRIQUECIMENTO.
//
// POR QUE ISSO EXISTE (medido em 07/09/2026, não estimado).
//
// A coleta fala com DUAS APIs do PNCP, e elas caem separado:
//
//   /api/consulta/v1 — a LISTA de contratações. É a coleta em si.
//   /api/pncp/v1     — os ITENS e RESULTADOS de cada contratação. É o enriquecimento.
//
// Em 07/09/2026 às 06:12 a lista respondia HTTP 200 em 3,1s enquanto a de itens
// devolvia HTTP 503 em 245ms, três vezes seguidas. Rejeição em 245ms é serviço
// fora, não sobrecarga nossa — fosse nossa viria 429, e vieram ZERO 429 em 417
// erros.
//
// O estrago não é perder item. É que cada chamada morta esgota as 5 tentativas do
// `fetchJson` com espera de 2+4+6+8+10 = 30 SEGUNDOS, e há uma dessas POR
// REGISTRO, 50 registros por página. A rodada das 05:00 gastou 70 minutos para
// fazer 14 páginas de UMA UF das 27 e não gravou uma linha nova: o orçamento
// evaporou dormindo.
//
// O circuit breaker que já existia no `etl-pncp` conta falhas de PÁGINA DA LISTA,
// e a lista estava saudável — por isso ele nunca disparou. Este é do outro lado.
//
// O QUE ELE FAZ: depois de LIMITE falhas seguidas, desliga o enriquecimento e
// deixa a coleta seguir só com a lista. A contratação entra no banco do mesmo
// jeito, porque o upsert do cabeçalho acontece ANTES do enriquecimento — era o
// que o log já dizia em "183c/0i/0r": 183 contratações e zero itens. E existe o
// `backfill-itens` justamente para preencher item depois.
//
// POR QUE NÃO DESLIGA DE VEZ: uma queda de dois minutos não pode custar o
// enriquecimento de uma rodada de duas horas. Passada a ESPERA, deixa UMA chamada
// passar; se ela voltar, religa. A sonda custa os mesmos 30s de uma falha, e é por
// isso que a espera se mede em minutos e não em segundos.
//
// CONTRATO DE USO: quem chama pergunta `podeEnriquecer()` UMA vez por chamada que
// pretende fazer e depois relata o desfecho com `registrarSucesso()` ou
// `registrarFalha()`. Perguntar sem chamar desperdiça a meia-abertura.

const LIMITE = Number(process.env.PNCP_ENRIQ_LIMITE ?? 5)
const ESPERA_MS = Number(process.env.PNCP_ENRIQ_ESPERA_MIN ?? 10) * 60 * 1000

let falhasSeguidas = 0
let abertoDesde = null // null = fechado (enriquecendo normalmente)
let desligamentos = 0
let religamentos = 0
let puladas = 0

/** Pode fazer a chamada de enriquecimento agora? */
export function podeEnriquecer(agora = Date.now()) {
  if (abertoDesde === null) return true
  // Meia-abertura: cumprida a espera, UMA chamada passa para sondar se voltou.
  if (agora - abertoDesde >= ESPERA_MS) return true
  puladas++
  return false
}

/** O enriquecimento respondeu. 404/204 também contam: o serviço está de pé, só
 *  não há conteúdo — e é justamente essa distinção que o `fetchJsonSafe` perdia
 *  ao devolver null para "sem itens" e para "serviço fora" com a mesma cara. */
export function registrarSucesso() {
  const religou = abertoDesde !== null
  if (religou) religamentos++
  falhasSeguidas = 0
  abertoDesde = null
  return religou
}

/** O enriquecimento falhou. Devolve true SÓ na transição que desliga, para o
 *  chamador conseguir avisar uma vez em vez de a cada registro. */
export function registrarFalha(agora = Date.now()) {
  falhasSeguidas++
  if (abertoDesde !== null) {
    // A sonda da meia-abertura falhou: recomeça a espera em vez de insistir.
    abertoDesde = agora
    return false
  }
  if (falhasSeguidas >= LIMITE) {
    abertoDesde = agora
    desligamentos++
    return true
  }
  return false
}

export function resumo() {
  return {
    desligamentos, religamentos, puladas,
    aberto: abertoDesde !== null,
    limite: LIMITE,
    esperaMin: ESPERA_MS / 60000,
  }
}

/** Só para teste: devolve o módulo ao estado inicial. */
export function reiniciar() {
  falhasSeguidas = 0; abertoDesde = null
  desligamentos = 0; religamentos = 0; puladas = 0
}
