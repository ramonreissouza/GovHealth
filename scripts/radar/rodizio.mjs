// scripts/radar/rodizio.mjs — quem foi lido na passada anterior cede a vez na próxima.
//
// O DEFEITO, medido em 22/09/2026 no Licitanet:
//
//   "o Licitanet recusou a conexão (HTTP 429) — 21 de 60 processo(s) lidos antes;
//    parei na 1ª recusa para não insistir contra o bloqueio"
//
// O conector agiu certo: parou e contou a verdade. O problema é a passada SEGUINTE.
// A lista dos processos públicos é ordenada por proximidade da sessão e essa ordem é
// ESTÁVEL — então a passada seguinte começa do mesmo primeiro, lê os mesmos ~21 e leva
// 429 no mesmo ponto. Os processos 22 a 60 nunca são lidos. Passada após passada.
//
// O teto configurado era 60; o teto REAL virou 21, e a cauda ficou permanentemente fria
// sem nada na tela dizendo isso. É a forma mais cara de silêncio que existe aqui: o
// cliente vê "Licitanet · 21 lidos" e supõe cobertura.
//
// ── POR QUE ROTACIONAR, E NÃO SÓ "IR MAIS DEVAGAR" ───────────────────────────────────
//
// Não sabemos a regra do WAF deles. Chutar um intervalo que "deve passar" é palpite, e
// um palpite errado mantém o buraco e ainda demora mais. Rotacionar não depende de
// conhecer a regra: seja qual for o ponto em que eles cortam, a passada seguinte começa
// depois dele, e em algumas passadas a lista inteira foi coberta.
//
// ── POR QUE SÓ NA PASSADA COMPLETA ───────────────────────────────────────────────────
//
// A passada de URGÊNCIA (`--urgentes`, a cada 20 min) já é filtrada para quem tem sessão
// à porta — lá a ordem "mais quente primeiro" é a resposta certa e rodar seria errado:
// um pregão com sessão hoje não pode ceder a vez para um de mês que vem. O rodízio vale
// na passada completa (2 h), que é a que existe para dar cobertura.

/**
 * Gira a lista para começar em `offset`, preservando a ordem relativa.
 *
 * Preserva a ordem de propósito: a ordenação "mais quente primeiro" é política do
 * `run.mjs` e continua valendo DENTRO da volta. O rodízio decide onde a volta COMEÇA,
 * não em que ordem as coisas ficam.
 *
 * @template T
 * @param {T[]} lista
 * @param {number} offset
 * @returns {T[]}
 */
export function rotacionar(lista, offset) {
  if (!Array.isArray(lista) || lista.length === 0) return []
  const n = lista.length
  // Offset sujo (negativo, fracionário, gigante, NaN vindo do banco) não pode derrubar
  // a passada nem embaralhar a lista: normaliza para dentro de [0, n).
  const bruto = Number(offset)
  const k = Number.isFinite(bruto) ? ((Math.trunc(bruto) % n) + n) % n : 0
  if (k === 0) return lista.slice()
  return [...lista.slice(k), ...lista.slice(0, k)]
}

/**
 * Onde a próxima passada deve começar.
 *
 * `lidos` é quantos o conector conseguiu ler DE VERDADE nesta volta — não quantos foram
 * entregues a ele. É essa a diferença que conserta o bug: avançar pelo entregue pularia
 * os 39 que o portal recusou, e o buraco só mudaria de lugar.
 *
 * Quando nada foi lido (portal fora do ar, navegador não subiu), o ponto NÃO anda. Andar
 * ali seria cobrar o rodízio por uma falha que não foi de leitura, e a cada queda do
 * portal um pedaço da lista seria pulado sem nunca ter sido tentado.
 *
 * @param {number} offset   de onde esta passada começou
 * @param {number} lidos    quantos o conector leu de verdade
 * @param {number} total    tamanho da lista girada
 * @returns {number} offset para a próxima passada, sempre em [0, total)
 */
export function proximoOffset(offset, lidos, total) {
  const n = Number(total)
  if (!Number.isFinite(n) || n <= 0) return 0
  const l = Number(lidos)
  if (!Number.isFinite(l) || l <= 0) return ((Math.trunc(Number(offset) || 0) % n) + n) % n
  const base = Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0
  return (((base + Math.trunc(l)) % n) + n) % n
}

/** Chave do ponto de rodízio em `etl_checkpoint`. Uma por portal e por titular. */
export function chaveRodizio(portalId, titularId) {
  return `radar:rodizio:${portalId}:${titularId}`
}

/**
 * Frase para o log e para a saúde do conector.
 *
 * Existe porque rodízio silencioso é indistinguível de rodízio que não aconteceu — e a
 * pergunta que alguém vai fazer olhando a tela é "por que o processo X não foi lido
 * hoje?". A resposta tem de estar escrita.
 */
export function explicarRodizio(offset, total) {
  if (!total) return ''
  if (!offset) return `volta começando do 1º de ${total}`
  return `volta começando do ${offset + 1}º de ${total} (os anteriores foram lidos na passada passada)`
}
