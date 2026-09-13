// scripts/radar/browser-service.mjs — SERVIÇO DE NAVEGADOR HOSPEDADO (host/VPS).
// Fala com o steel-browser: cria a sessão, abre o gov.br, expõe a URL de live view
// (embutida num iframe pela tela) e, ao final, extrai a sessão (cookies) via CDP e
// grava cifrada. O app Next só faz PROXY para cá (com token). Requer Playwright,
// então roda no host — nunca na Vercel.
//
// Subir:  npm run radar:browser-service   (após: docker compose -f docker-compose.radar.yml up -d)
// Porta:  RADAR_CONNECT_PORT (padrão 3200). Auth: header x-radar-token = RADAR_CONNECT_TOKEN.

import http from 'node:http'
import fs from 'node:fs'
import pg from 'pg'
import net from 'node:net'
import crypto from 'node:crypto'
import { criarSessao, idDe, cdpUrlDe, encerrarSessao, sessaoAtivaId, ACOMPANHAMENTO_URL } from './steel.mjs'
import { encrypt } from './capture.mjs'
import { pegar, anotarSessao, podeCapturar, donoDoToken, soltar } from './pista-navegador.mjs'
import { PORTAIS } from './portais.mjs'

function loadEnv() {
  try {
    const e = fs.readFileSync('.env.local', 'utf8')
    for (const k of ['DATABASE_URL', 'RADAR_CRED_KEY', 'RADAR_CONNECT_TOKEN', 'RADAR_CONNECT_PORT', 'RADAR_STEEL_URL', 'RADAR_STEEL_CDP', 'RADAR_STEEL_EMBED_TEMPLATE']) {
      if (process.env[k]) continue
      const m = e.match(new RegExp(`^${k}=(.*)$`, 'm'))
      if (m) process.env[k] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {}
}
loadEnv()
for (const k of ['DATABASE_URL', 'RADAR_CRED_KEY', 'RADAR_CONNECT_TOKEN']) {
  if (!process.env[k]) { console.error(`ERRO: ${k} não configurada.`); process.exit(1) }
}
const KEY = process.env.RADAR_CRED_KEY
const TOKEN = process.env.RADAR_CONNECT_TOKEN
const PORT = Number(process.env.RADAR_CONNECT_PORT || '3200')

// Endereço PÚBLICO deste serviço (a ponta do túnel), que é o que vai dentro do iframe
// no navegador do fornecedor. Não é o endereço do steel — o steel nunca é publicado.
// Precisa ser https: a CSP da app manda `upgrade-insecure-requests`, então um http
// puro aqui seria reescrito para https e o iframe não carregaria. O mesmo valor vai em
// RADAR_EMBED_ORIGIN na Vercel, que é o que libera a origem na CSP.
const PUBLICO = (process.env.RADAR_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '')

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 })
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows)

async function playwright() {
  try { const { chromium } = await import('playwright'); return chromium }
  catch { throw new Error('Playwright não instalado (npx playwright install chromium)') }
}

async function marcarSaude(cred, status, detalhe) {
  await q(`INSERT INTO radar_saude (credencial_id,titular_id,conector_id,status,verificado_em,tentado_em,detalhe,atualizado_em)
    VALUES ($1,$2,$3,$4, ${status === 'ok' ? 'now()' : 'NULL'}, now(), $5, now())
    -- WHERE obrigatório: radar_saude_cred_uq é índice único PARCIAL; sem repetir o
    -- predicado o Postgres não o infere e devolve 42P10.
    ON CONFLICT (credencial_id) WHERE credencial_id IS NOT NULL DO UPDATE SET status=EXCLUDED.status,
      verificado_em=${status === 'ok' ? 'now()' : 'radar_saude.verificado_em'}, tentado_em=now(), detalhe=EXCLUDED.detalhe, atualizado_em=now()`,
    [cred.id, cred.titular_id, cred.conector_id, status, detalhe ?? null])
}

// Inicia a sessão: cria no steel, abre o gov.br, guarda id+embed, devolve o embedUrl.
async function iniciar(credencialId) {
  const [cred] = await q(`SELECT id, titular_id, conector_id, cnpj FROM radar_credenciais WHERE id=$1`, [credencialId])
  if (!cred) return { erro: 'credencial não encontrada', status: 404 }

  // A PISTA ANTES DE TUDO. Criar a sessão primeiro seria justamente o estrago: o
  // `POST /v1/sessions` do steel MATA a sessão ativa, então um segundo pedido
  // derrubaria o login de quem está no meio dele antes de descobrirmos que a pista
  // estava ocupada. Recusar é a resposta certa — o outro fornecedor termina em minutos.
  const vez = pegar(credencialId)
  if (!vez.ok) {
    return { erro: 'navegador ocupado', status: 409,
      detalhe: `Outro fornecedor está concluindo o login do gov.br agora. Tente de novo em ${Math.ceil((vez.esperaMs ?? 0) / 60000)} min.` }
  }

  let session
  try { session = await criarSessao({}) }
  catch (e) { soltar(credencialId); return { erro: `falha ao criar a sessão: ${e.message}`, status: 502 } }
  const sessionId = idDe(session)
  const cdp = cdpUrlDe(session)

  // O token do live view: é o que substitui a URL aberta do steel. Ver o porteiro
  // em `/live/` mais abaixo.
  const token = crypto.randomBytes(32).toString('hex')
  anotarSessao(credencialId, { sessionId, token })
  const embedUrl = `${PUBLICO}/live/${token}`

  // Abre a TELA DE LOGIN do portal da credencial (não a área autenticada).
  //
  // Ia para a `ACOMPANHAMENTO_URL`, que é o destino DEPOIS do login. Como a SPA do
  // Compras.gov.br não redireciona quem chega sem sessão, o fornecedor caía numa
  // "Página não encontrada" dentro do iframe — com cadeado verde e tudo, o que fazia
  // parecer problema de certificado. O registro já tinha a URL certa por portal; era
  // só usá-la, e assim isto passa a valer para PCP, BLL e os demais também.
  const portal = PORTAIS[cred.conector_id]
  const urlDeEntrada = portal?.loginUrl ?? ACOMPANHAMENTO_URL
  try {
    const chromium = await playwright()
    const browser = await chromium.connectOverCDP(cdp)
    const ctx = browser.contexts()[0] ?? (await browser.newContext())
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(urlDeEntrada, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await browser.close() // desconecta do CDP; a sessão steel continua viva
  } catch (e) {
    await encerrarSessao(sessionId).catch(() => {})
    soltar(credencialId)
    return { erro: `falha ao abrir o gov.br: ${e.message}`, status: 502 }
  }

  await q(`UPDATE radar_credenciais SET conexao_status='conectando', conexao_session_id=$2, conexao_embed_url=$3, conexao_pedido_em=now(), conexao_detalhe=NULL, atualizado_em=now() WHERE id=$1`,
    [cred.id, sessionId, embedUrl])
  return { embedUrl, sessionId }
}

// Captura: lê a sessão (cookies) via CDP, cifra, grava e encerra a sessão steel.
async function capturar(credencialId) {
  const [cred] = await q(`SELECT id, titular_id, conector_id, cnpj, conexao_session_id FROM radar_credenciais WHERE id=$1`, [credencialId])
  if (!cred) return { erro: 'credencial não encontrada', status: 404 }
  if (!cred.conexao_session_id) return { erro: 'nenhuma sessão em andamento', status: 400 }

  // A FRONTEIRA. Sem isto, `contexts()[0]` do navegador único devolve o que estiver
  // carregado — e o que estiver carregado pode ser a sessão gov.br de OUTRO cliente,
  // que seria cifrada e gravada como credencial deste. Duas conferências: a pista
  // (ninguém entrou por cima) e o id da sessão viva no steel (o navegador que vamos
  // ler é o que esta credencial abriu). Uma só não basta.
  const ativaNoSteel = await sessaoAtivaId()
  const pode = podeCapturar(credencialId, ativaNoSteel)
  if (!pode.ok) {
    await q(`UPDATE radar_credenciais SET conexao_status='erro', conexao_detalhe=$2 WHERE id=$1`, [cred.id, pode.motivo.slice(0, 180)])
    return { erro: pode.motivo, status: 409 }
  }
  // O id gravado no banco também tem de bater: protege contra o serviço ter
  // reiniciado e a pista ter sido retomada por outro pedido no intervalo.
  if (ativaNoSteel && ativaNoSteel !== cred.conexao_session_id) {
    return { erro: 'a sessão ativa no navegador não corresponde à desta credencial — captura recusada', status: 409 }
  }

  try {
    const chromium = await playwright()
    // Reconecta ao mesmo browser do steel para ler o estado autenticado.
    const cdp = process.env.RADAR_STEEL_CDP || 'http://localhost:9223'
    const browser = await chromium.connectOverCDP(cdp)
    const ctx = browser.contexts()[0]
    if (!ctx) { await browser.close(); return { erro: 'sessão sem contexto ativo', status: 502 } }
    const url = ctx.pages()[0]?.url() ?? ''
    const estado = await ctx.storageState()
    const storageState = JSON.stringify(estado)
    await browser.close()

    // URL NÃO PROVA LOGIN — e este projeto já pagou por isso uma vez (o falso
    // "conectado" do Radar). Medido em 11/09/2026 contra o steel real: uma sessão em
    // que NINGUÉM logou parou em `/comprasnet-web/seguro/acompanhamento`, que não casa
    // com nenhum padrão de login. Só pela URL, o serviço declararia sucesso, cifraria
    // um cofre VAZIO e marcaria a saúde como ok. O fornecedor veria "Conectado ao
    // gov.br" e o monitoramento nunca traria uma mensagem.
    //
    // O sinal que não mente é o cofre ter conteúdo: sessão autenticada TEM cookie.
    // Zero cookie é, com certeza, login não concluído — e é a checagem barata que
    // pega o caso comum de "cliquei em já concluí antes de terminar".
    const emLogin = /acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url)
    const semCookie = !estado.cookies?.length

    if (emLogin || semCookie) {
      const porque = semCookie ? 'nenhum cookie de sessão — o login não foi concluído' : 'ainda na tela de login do gov.br'
      await marcarSaude(cred, 'sessao_expirada', `Login ainda não concluído: ${porque}`)
      return { status: 200, conexao: 'conectando', aviso: porque }
    }

    await q(`UPDATE radar_credenciais SET storage_state=$2, metodo='sessao', conexao_status='conectado', conexao_detalhe=NULL, ativo=true, atualizado_em=now() WHERE id=$1`,
      [cred.id, encrypt(KEY, storageState)])
    await marcarSaude(cred, 'ok', 'sessão capturada via gov.br (navegador hospedado)')
    await q(`INSERT INTO radar_auditoria (titular_id,acao,entidade,entidade_id,detalhe) VALUES ($1,'cred_conectada','radar_credenciais',$2,$3::jsonb)`,
      [cred.titular_id, cred.id, JSON.stringify({ via: 'hosted' })])
    await encerrarSessao(cred.conexao_session_id).catch(() => {})
    // Pista livre e token morto no mesmo instante em que a sessão é gravada: o live
    // view não pode sobreviver à captura, senão o link continuaria abrindo um
    // navegador autenticado depois de o fornecedor achar que terminou.
    soltar(credencialId)
    return { status: 200, conexao: 'conectado' }
  } catch (e) {
    await q(`UPDATE radar_credenciais SET conexao_status='erro', conexao_detalhe=$2 WHERE id=$1`, [cred.id, String(e.message).slice(0, 180)])
    return { erro: e.message, status: 502 }
  }
}

async function cancelar(credencialId) {
  const [cred] = await q(`SELECT id, conexao_session_id FROM radar_credenciais WHERE id=$1`, [credencialId])
  if (cred?.conexao_session_id) await encerrarSessao(cred.conexao_session_id).catch(() => {})
  await q(`UPDATE radar_credenciais SET conexao_status='idle', conexao_session_id=NULL, conexao_embed_url=NULL WHERE id=$1`, [credencialId])
  soltar(credencialId)
  return { status: 200, ok: true }
}

function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch { resolve({}) } }) })
}

// ── O LIVE VIEW COM PORTEIRO ─────────────────────────────────────────────────
// A documentação do steel diz, com todas as letras, que as debug URLs são
// "intentionally unauthenticated for fast embeds". E a rota do live view é fixa —
// `/v1/sessions/debug`, sem id — então não há nem segredo por obscuridade: quem
// souber o hostname abre. Publicar o steel direto no túnel seria pôr na internet uma
// URL que DIRIGE um navegador logado no gov.br de um cliente.
//
// Então o steel NÃO vai para o túnel. Só este serviço vai, e ele serve o live view em
// `/live/<token>`: token de 32 bytes, sorteado por sessão, válido enquanto a pista for
// daquela credencial e morto no cancelar/capturar. O steel fica em localhost.
const STEEL = (process.env.RADAR_STEEL_URL || 'http://localhost:3100').replace(/\/$/, '')

function alvoDoLive(caminhoRestante) {
  // O que o iframe pede depois da página (assets, /v1/..., websocket) vai para o steel
  // no mesmo caminho; só o prefixo /live/<token> é nosso.
  return caminhoRestante && caminhoRestante !== '/' ? caminhoRestante : '/v1/sessions/debug'
}

// O HTML do player traz o endereço do websocket CRAVADO, com o endereço interno do
// container — medido em 13/09/2026:
//
//     const baseWsUrl = 'ws://0.0.0.0:3000/v1/sessions/cast';
//
// O `rebasear()` do steel.mjs não alcança isto: ele conserta as URLs que a API do steel
// DEVOLVE, e esta vem dentro do corpo da página. Sem reescrever, o navegador do
// fornecedor tenta abrir um websocket para 0.0.0.0 (que não existe) e ainda em `ws://`
// dentro de uma página https — o player carrega e fica "Session not connected".
//
// As queries são anexadas depois (`?tabInfo=true`, `?pageId=…`), então basta trocar a
// base: o proxy de upgrade já preserva pathname + search.
export function reescreverPlayer(html, token, publico = PUBLICO) {
  const base = new URL(publico)
  const prefixo = `${base.host}/live/${token}`
  const seguro = base.protocol === 'https:'
  return html
    .replace(/wss?:\/\/(?:0\.0\.0\.0|localhost|127\.0\.0\.1):3000/g, `${seguro ? 'wss:' : 'ws:'}//${prefixo}`)
    .replace(/https?:\/\/(?:0\.0\.0\.0|localhost|127\.0\.0\.1):3000/g, `${base.protocol}//${prefixo}`)
}

function repassar(req, res, caminho, token) {
  const alvo = new URL(STEEL + caminho)
  // Host reescrito: o steel responde para si mesmo, não para o hostname do túnel.
  const cabecalhos = { ...req.headers, host: alvo.host }
  // O token interno NÃO segue para o steel. Atenção: `{'x-radar-token': undefined}`
  // NÃO remove o cabeçalho — o Node tenta escrever o valor e lança
  // ERR_HTTP_INVALID_HEADER_VALUE, de forma SÍNCRONA, antes de existir listener de
  // 'error'. Era uma queda do processo inteiro no primeiro live view legítimo: o
  // porteiro recusava link inválido com 403 sem chegar aqui, então só quebrava quando
  // um token VÁLIDO passava — isto é, exatamente quando um cliente conectava.
  delete cabecalhos['x-radar-token']
  // Pedimos sem compressão: precisamos LER o HTML do player para reescrevê-lo, e
  // descomprimir aqui só para recomprimir depois seria trabalho à toa.
  delete cabecalhos['accept-encoding']
  const r = http.request({
    hostname: alvo.hostname, port: alvo.port || 80, path: alvo.pathname + alvo.search,
    method: req.method,
    headers: cabecalhos,
  }, (resp) => {
    // Só o HTML precisa de reescrita. Todo o resto (imagens, js, o que for) passa
    // direto, sem ficar na memória.
    if (!String(resp.headers['content-type'] ?? '').includes('text/html')) {
      res.writeHead(resp.statusCode ?? 502, resp.headers)
      return resp.pipe(res)
    }
    const pedacos = []
    resp.on('data', (d) => pedacos.push(d))
    resp.on('end', () => {
      const html = reescreverPlayer(Buffer.concat(pedacos).toString('utf8'), token)
      const cab = { ...resp.headers, 'content-length': Buffer.byteLength(html) }
      res.writeHead(resp.statusCode ?? 502, cab)
      res.end(html)
    })
    resp.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  })
  r.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end(`live view indisponível: ${e.message}`) })
  req.pipe(r)
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }

  // O live view é o ÚNICO caminho que não exige o token interno do app: quem o abre é
  // o navegador do fornecedor, que não tem (e não pode ter) esse segredo. Ele é
  // autorizado pelo token da URL, que vale só para a sessão em andamento.
  if (req.url?.startsWith('/live/')) {
    const [, , tok, ...resto] = req.url.split('/')
    const dono = donoDoToken((tok ?? '').split('?')[0])
    if (!dono) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('sessão expirada ou link inválido') }
    // Rede de proteção: um defeito aqui NÃO pode derrubar o serviço. Este caminho é o
    // único aberto à internet, e quem paga a queda é o fornecedor no meio do login.
    try {
      return repassar(req, res, alvoDoLive('/' + resto.join('/')), (tok ?? '').split('?')[0])
    } catch (e) {
      console.error('[browser-service] live view:', e)
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('live view indisponível')
    }
  }

  if (req.method !== 'POST') return send(405, { erro: 'method' })
  if (req.headers['x-radar-token'] !== TOKEN) return send(401, { erro: 'unauthorized' })
  const body = await readBody(req)
  const id = body.credencialId
  if (!id) return send(400, { erro: 'credencialId obrigatório' })
  try {
    let r
    if (req.url === '/session') r = await iniciar(id)
    else if (req.url === '/capture') r = await capturar(id)
    else if (req.url === '/cancel') r = await cancelar(id)
    else return send(404, { erro: 'rota' })
    send(r.status && r.erro ? r.status : 200, r)
  } catch (e) {
    console.error('[browser-service]', e)
    send(500, { erro: String(e.message ?? e) })
  }
})
// O live view é uma página que fala com o navegador por WEBSOCKET. Sem repassar o
// upgrade, o iframe carrega o HTML e fica parado — parecendo "quase funcionando", que
// é o pior jeito de falhar. O mesmo token da URL manda aqui.
server.on('upgrade', (req, socket, head) => {
  const recusar = (motivo) => { socket.write(`HTTP/1.1 403 Forbidden\r\n\r\n${motivo}`); socket.destroy() }
  if (!req.url?.startsWith('/live/')) return recusar('rota')
  const [, , tok, ...resto] = req.url.split('/')
  if (!donoDoToken((tok ?? '').split('?')[0])) return recusar('sessão expirada ou link inválido')

  const alvo = new URL(STEEL + (resto.length ? '/' + resto.join('/') : '/'))
  const upstream = net.connect(Number(alvo.port || 80), alvo.hostname, () => {
    const cabecalhos = Object.entries(req.headers)
      .filter(([k]) => k !== 'host')
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n')
    upstream.write(`GET ${alvo.pathname}${alvo.search} HTTP/1.1\r\nHost: ${alvo.host}\r\n${cabecalhos}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PORT, () => {
  console.log(`Radar browser-service ouvindo em :${PORT} (steel=${STEEL})`)
  console.log(`  live view publicado em ${PUBLICO}/live/<token>`)
  if (!process.env.RADAR_PUBLIC_URL) console.warn('  AVISO: RADAR_PUBLIC_URL não definida — o iframe vai apontar para localhost e só funcionará nesta máquina')
  else if (!PUBLICO.startsWith('https://')) console.warn('  AVISO: RADAR_PUBLIC_URL não é https — a CSP da app reescreve para https e o iframe não vai carregar')
})
