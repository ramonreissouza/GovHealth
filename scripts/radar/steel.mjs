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

/** URL de live view para embutir no iframe. Prioriza o que o steel devolve; senão template/env. */
export function embedUrlDe(session) {
  const direto = session.sessionViewerUrl ?? session.debugUrl ?? session.liveViewUrl ?? session.debuggerUrl
  if (direto) return direto
  const id = idDe(session)
  if (EMBED_TEMPLATE) return EMBED_TEMPLATE.replace('{id}', id)
  // Derivação padrão (⚠ confirmar no container): página de debug da sessão.
  return `${STEEL_URL}/v1/sessions/${id}/debug`
}

/** Endpoint para o Playwright.connectOverCDP. Prioriza ws da sessão; senão o CDP global. */
export function cdpUrlDe(session) {
  return session.websocketUrl ?? session.connectUrl ?? session.wsEndpoint ?? STEEL_CDP
}

/** Encerra/libera a sessão (best-effort). */
export async function encerrarSessao(id) {
  if (!id) return
  try { await req(`/v1/sessions/${id}`, { method: 'DELETE' }) }
  catch { try { await req(`/v1/sessions/${id}/release`, { method: 'POST' }) } catch { /* ignore */ } }
}

export const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/acompanhamento'
