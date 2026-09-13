// PISTA DO NAVEGADOR HOSPEDADO — um fornecedor conectando por vez.
//
// POR QUE ISSO EXISTE (lido no código do steel em 10/09/2026, não suposto).
//
// O steel-browser open-source roda UMA sessão por vez. Em
// `api/src/services/session.service.ts` o estado é `public activeSession: Session`
// — um campo, não um mapa — e `startSession()` chama `resetSessionInfo()`, que
// encerra a sessão ativa antes de abrir a nova. A rota de live view é
// `/v1/sessions/debug`, SEM id, pela mesma razão.
//
// Sem serializar, dois fornecedores conectando ao mesmo tempo dão dois estragos, e o
// segundo é grave:
//
//   1) o segundo a pedir MATA o login do primeiro no meio, e o primeiro vê o iframe
//      morrer sem explicação;
//   2) a captura lê `contexts()[0]` do navegador ÚNICO. Se a sessão viva naquele
//      instante for a do outro fornecedor, grava-se a sessão gov.br DELE como
//      credencial DESTE. Vazamento de sessão entre clientes.
//
// Por isso a pista não é otimização de desempenho: é a fronteira que impede o
// vazamento. Quem não tem a pista não captura — ver `podeCapturar()`.
//
// É EM MEMÓRIA, e isso é correto aqui (diferente do `pncp-lock.mjs`, que é em arquivo
// porque coordena processos distintos). Há UM browser-service para UM steel; se o
// serviço reinicia, não há sessão viva para proteger, porque o steel morre junto.
//
// O TTL existe porque o caso comum de abandono é silencioso: o fornecedor fecha a aba
// no meio do login e nunca chama capturar nem cancelar. Sem prazo, a pista ficaria
// ocupada por um fantasma e ninguém mais conectaria — trocaríamos o vazamento por uma
// negação de serviço permanente.

const TTL_PADRAO_MS = Number(process.env.RADAR_PISTA_TTL_MIN ?? 10) * 60 * 1000

let dono = null // { credencialId, sessionId, token, desde, ate }

/** Tenta tomar a pista para uma credencial. Devolve { ok, dono, esperaMs }. */
export function pegar(credencialId, { agora = Date.now(), ttlMs = TTL_PADRAO_MS } = {}) {
  if (!credencialId) return { ok: false, motivo: 'credencial ausente' }
  expirar(agora)
  if (dono && dono.credencialId !== credencialId) {
    return { ok: false, motivo: 'ocupada', dono: dono.credencialId, esperaMs: Math.max(0, dono.ate - agora) }
  }
  // Retomada pelo mesmo dono: renova o prazo em vez de recusar. O fornecedor que
  // recarrega a página não deve perder a vez para si mesmo.
  dono = { credencialId, sessionId: dono?.sessionId ?? null, token: dono?.token ?? null, desde: dono?.desde ?? agora, ate: agora + ttlMs }
  return { ok: true, dono: credencialId, ate: dono.ate }
}

/** Registra a sessão do steel e o token do live view depois que a sessão nasceu. */
export function anotarSessao(credencialId, { sessionId, token } = {}) {
  if (!dono || dono.credencialId !== credencialId) return false
  if (sessionId !== undefined) dono.sessionId = sessionId
  if (token !== undefined) dono.token = token
  return true
}

/** A pergunta que impede o vazamento: esta credencial pode capturar AGORA?
 *
 *  Duas condições, e as duas são necessárias. A pista garante que ninguém entrou por
 *  cima; a conferência do id garante que o navegador que vamos ler é o mesmo que esta
 *  credencial abriu — se o steel trocou de sessão por qualquer motivo, o que está lá
 *  não é nosso e não pode ser gravado. */
export function podeCapturar(credencialId, sessionIdAtivaNoSteel, { agora = Date.now() } = {}) {
  expirar(agora)
  if (!dono) return { ok: false, motivo: 'nenhuma conexão em andamento (a pista expirou ou foi cancelada)' }
  if (dono.credencialId !== credencialId) return { ok: false, motivo: 'outra credencial está conectando agora' }
  if (!dono.sessionId) return { ok: false, motivo: 'sessão não registrada' }
  if (sessionIdAtivaNoSteel && sessionIdAtivaNoSteel !== dono.sessionId) {
    return { ok: false, motivo: 'a sessão ativa no navegador não é a desta credencial — captura recusada' }
  }
  return { ok: true }
}

/** Valida o token do live view. Token errado ou de sessão encerrada não abre nada. */
export function donoDoToken(token, { agora = Date.now() } = {}) {
  expirar(agora)
  if (!token || !dono || !dono.token) return null
  // Comparação de tamanho fixo primeiro: token de tamanho diferente nem chega a comparar.
  if (token.length !== dono.token.length) return null
  let dif = 0
  for (let i = 0; i < token.length; i++) dif |= token.charCodeAt(i) ^ dono.token.charCodeAt(i)
  return dif === 0 ? { ...dono } : null
}

export function soltar(credencialId) {
  if (dono && credencialId && dono.credencialId !== credencialId) return false
  dono = null
  return true
}

export function expirar(agora = Date.now()) {
  if (dono && agora >= dono.ate) { const ido = dono; dono = null; return ido }
  return null
}

export function estado(agora = Date.now()) {
  expirar(agora)
  return dono ? { ocupada: true, credencialId: dono.credencialId, sessionId: dono.sessionId, restaMs: dono.ate - agora } : { ocupada: false }
}

/** só para teste */
export function reiniciar() { dono = null }
