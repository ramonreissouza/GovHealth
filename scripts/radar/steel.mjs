// scripts/radar/steel.mjs — ADAPTADOR do steel-browser (navegador hospedado).
// Concentra AQUI tudo que depende da API do steel, para que, ao subir o container,
// baste ajustar um ponto. Tudo configurável por env (RADAR_STEEL_*).
//
// Referência: steel-browser self-host — POST /v1/sessions, CDP na 9223, UI em /ui.
// Como alguns nomes de campo variam entre versões, cada getter tenta vários e cai
// num template/derivação por env se não achar (marque com ⚠ ao validar no container).

const STEEL_URL = (process.env.RADAR_STEEL_URL || 'http://localhost:3100').replace(/\/$/, '')
const STEEL_CDP = (process.env.RADAR_STEEL_CDP || 'http://localhost:9223').replace(/\/$/, '')
const EMBED_TEMPLATE = process.env.RADAR_STEEL_EMBED_TEMPLATE || ''

async function req(path, opts = {}) {
  const r = await fetch(`${STEEL_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const txt = await r.text()
  let body
  try { body = txt ? JSON.parse(txt) : {} } catch { body = { raw: txt } }
  if (!r.ok) throw new Error(`steel ${path} -> ${r.status} ${txt.slice(0, 200)}`)
  return body
}

/** Cria uma sessão de navegador. Retorna o objeto cru do steel (contém id). */
export async function criarSessao({ width = 1280, height = 800 } = {}) {
  const s = await req('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ blockAds: true, dimensions: { width, height } }),
  })
  return s.session ?? s // algumas versões aninham em {session:{...}}
}

/** id da sessão, tolerante a variações de nome. */
export function idDe(session) {
  return session.id ?? session.sessionId ?? session.session_id
}

/** URL de live view para embutir no iframe.
 *
 *  A ORDEM AQUI IMPORTA, e estava errada até 10/09/2026. O schema do steel
 *  (api/src/modules/sessions/sessions.schema.ts) descreve os campos assim:
 *
 *    debugUrl         "URL for a viewing the live browser instance for the session"
 *    sessionViewerUrl "URL to view session details"
 *
 *  Ou seja: `debugUrl` é o navegador AO VIVO, onde uma pessoa digita; o
 *  `sessionViewerUrl` é a página de DETALHES da sessão. A versão anterior tentava o
 *  sessionViewerUrl primeiro — o fornecedor abriria o modal e veria metadados da
 *  sessão no lugar da tela de login do gov.br, sem nenhum erro em lugar nenhum.
 *  A documentação de embed do steel também aponta o debugUrl como o que se põe em
 *  iframe ("embedding live sessions with debugUrl iframes").
 *
 *  A DERIVAÇÃO DE RESERVA TAMBÉM ESTAVA ERRADA: a rota é `/v1/sessions/debug`, SEM
 *  id — conferido em api/src/modules/sessions/sessions.routes.ts. A rota com id que
 *  estava aqui (`/v1/sessions/{id}/debug`) não existe, e `/v1/sessions/{id}/player`,
 *  que a documentação mostra, responde 404 no self-hosted (é só da nuvem paga).
 *  A falta de id na rota não é descuido do steel: o servidor open-source só tem UMA
 *  sessão viva por vez (ver o cabeçalho de browser-service.mjs). */
export function embedUrlDe(session) {
  const direto = session.debugUrl ?? session.liveViewUrl ?? session.debuggerUrl
  // Rebaseado pelo mesmo motivo do cdpUrlDe: o que o steel devolve aponta para o
  // endereço interno do container. Note que `sessionViewerUrl` saiu da lista — com o
  // container real ele é `http://0.0.0.0:3000/`, a HOME do steel, não o navegador.
  if (direto) return rebasear(direto, STEEL_URL)
  if (EMBED_TEMPLATE) return EMBED_TEMPLATE.replace('{id}', idDe(session))
  return `${STEEL_URL}/v1/sessions/debug`
}

/** O steel devolve URLs com o endereço INTERNO do container, e elas não servem.
 *  Medido em 11/09/2026, com o container rodando:
 *
 *    websocketUrl      ws://0.0.0.0:3000/
 *    debugUrl          http://0.0.0.0:3000/v1/sessions/debug
 *    sessionViewerUrl  http://0.0.0.0:3000/
 *
 *  `0.0.0.0` é o endereço de escuta dele lá dentro, e 3000 é a porta interna — de fora
 *  do container o caminho é outro (aqui, localhost:3100). Usar o que ele devolve, como
 *  estava, dá `connect ECONNREFUSED` no Playwright e iframe morto.
 *
 *  Então mantemos o CAMINHO que o steel informa (é ele quem sabe a rota) e trocamos a
 *  ORIGEM pela que nós sabemos alcançar. */
function rebasear(url, base) {
  if (!url) return null
  try {
    const u = new URL(url)
    const b = new URL(base)
    u.protocol = u.protocol.startsWith('ws') ? (b.protocol === 'https:' ? 'wss:' : 'ws:') : b.protocol
    u.host = b.host
    return u.toString()
  } catch { return url }
}

/** Endpoint para o Playwright.connectOverCDP. Prioriza o ws da sessão — rebaseado —
 *  e cai no CDP configurado se a sessão não informar nenhum. */
export function cdpUrlDe(session) {
  const bruto = session.websocketUrl ?? session.connectUrl ?? session.wsEndpoint
  return bruto ? rebasear(bruto, STEEL_URL) : STEEL_CDP
}

/** Qual sessão está viva no steel AGORA. Existe para a captura poder conferir que o
 *  navegador que ela vai ler é o mesmo que a credencial abriu — sem isso, com o steel
 *  servindo uma sessão por vez, dá para gravar a sessão gov.br de um fornecedor como
 *  credencial de outro. Ver `pista-navegador.mjs`.
 *
 *  Devolve null se não der para saber. Quem chama trata null como "não confirmei" e
 *  decide pela pista — nunca como "está tudo certo". */
export async function sessaoAtivaId() {
  try {
    const r = await req('/v1/sessions')
    const lista = Array.isArray(r) ? r : (r.sessions ?? r.data ?? [])
    // O open-source mantém UMA ativa; se vier mais de uma, a viva é a que não terminou.
    const viva = lista.find((s) => (s.status ?? s.state) !== 'released' && !s.endedAt) ?? lista[0]
    return viva ? idDe(viva) : null
  } catch { return null }
}

/** CDP ALCANÇÁVEL da sessão viva.
 *
 *  Existe porque conectar no endpoint CRU (`http://localhost:9223`) NÃO funciona, e
 *  falha de um jeito que não parece o que é: o Playwright pede `/json/version`, o steel
 *  responde com um `webSocketDebuggerUrl` que carrega o endereço INTERNO do container,
 *  o Playwright segue esse endereço e termina em `connect ECONNREFUSED ::1:80`.
 *
 *  O `iniciar()` já usava `cdpUrlDe()` e por isso funcionava; o `capturar()` conectava
 *  no cru e morria — depois de o fornecedor ter digitado a senha e o 2FA. O erro
 *  chegava à tela como "Não foi possível capturar a sessão", sem nada apontando para
 *  um endereço de rede. Medido em 13/09/2026, com um cliente real no meio do login. */
export async function cdpUrlDaSessaoViva() {
  try {
    const r = await req('/v1/sessions')
    const lista = Array.isArray(r) ? r : (r.sessions ?? r.data ?? [])
    const viva = lista.find((s) => (s.status ?? s.state) !== 'released' && !s.endedAt) ?? lista[0]
    return viva ? cdpUrlDe(viva) : STEEL_CDP
  } catch { return STEEL_CDP }
}

/** Encerra/libera a sessão (best-effort). */
export async function encerrarSessao(id) {
  if (!id) return
  try { await req(`/v1/sessions/${id}`, { method: 'DELETE' }) }
  catch { try { await req(`/v1/sessions/${id}/release`, { method: 'POST' }) } catch { /* ignore */ } }
}

export const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/acompanhamento'
