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
import { criarSessao, idDe, embedUrlDe, cdpUrlDe, encerrarSessao, ACOMPANHAMENTO_URL } from './steel.mjs'
import { encrypt } from './capture.mjs'

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

  const session = await criarSessao({})
  const sessionId = idDe(session)
  const embedUrl = embedUrlDe(session)
  const cdp = cdpUrlDe(session)

  // Abre o gov.br dentro da sessão (para o fornecedor já cair na tela de login).
  try {
    const chromium = await playwright()
    const browser = await chromium.connectOverCDP(cdp)
    const ctx = browser.contexts()[0] ?? (await browser.newContext())
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(ACOMPANHAMENTO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await browser.close() // desconecta do CDP; a sessão steel continua viva
  } catch (e) {
    await encerrarSessao(sessionId).catch(() => {})
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

  try {
    const chromium = await playwright()
    // Reconecta ao mesmo browser do steel para ler o estado autenticado.
    const cdp = process.env.RADAR_STEEL_CDP || 'http://localhost:9223'
    const browser = await chromium.connectOverCDP(cdp)
    const ctx = browser.contexts()[0]
    if (!ctx) { await browser.close(); return { erro: 'sessão sem contexto ativo', status: 502 } }
    const url = ctx.pages()[0]?.url() ?? ''
    const emLogin = /acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url)
    const storageState = JSON.stringify(await ctx.storageState())
    await browser.close()

    if (emLogin) {
      await marcarSaude(cred, 'sessao_expirada', 'Login ainda não concluído no gov.br')
      return { status: 200, conexao: 'conectando', aviso: 'login ainda não concluído' }
    }

    await q(`UPDATE radar_credenciais SET storage_state=$2, metodo='sessao', conexao_status='conectado', conexao_detalhe=NULL, ativo=true, atualizado_em=now() WHERE id=$1`,
      [cred.id, encrypt(KEY, storageState)])
    await marcarSaude(cred, 'ok', 'sessão capturada via gov.br (navegador hospedado)')
    await q(`INSERT INTO radar_auditoria (titular_id,acao,entidade,entidade_id,detalhe) VALUES ($1,'cred_conectada','radar_credenciais',$2,$3::jsonb)`,
      [cred.titular_id, cred.id, JSON.stringify({ via: 'hosted' })])
    await encerrarSessao(cred.conexao_session_id).catch(() => {})
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
  return { status: 200, ok: true }
}

function readBody(req) {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch { resolve({}) } }) })
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
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
server.listen(PORT, () => console.log(`Radar browser-service ouvindo em :${PORT} (steel=${process.env.RADAR_STEEL_URL || 'http://localhost:3100'})`))
