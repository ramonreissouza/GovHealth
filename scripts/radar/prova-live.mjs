// Prova do caminho COMPLETO do live view: o que quebrou na tentativa do cliente.
// Faz o que a app faz — POST /session com o token interno — e depois busca a URL
// devolvida exatamente como o iframe buscaria. Cancela no fim, sempre.
import fs from 'node:fs'
import pg from 'pg'
import { novoClient } from '../lib/pg-ssl.mjs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
)

const TOKEN = env.RADAR_CONNECT_TOKEN
const BASE = 'http://127.0.0.1:3200'

const cli = novoClient(env.DATABASE_URL)
await cli.connect()
// Prefere uma credencial que NÃO esteja conectada. A sonda abre e cancela sessão; se
// escolhesse a credencial de um cliente em produção, mexeria na saúde dele por nada.
const { rows } = await cli.query(
  `SELECT id, conector_id FROM radar_credenciais
   ORDER BY (storage_state IS NOT NULL), criado_em DESC LIMIT 1`,
)
await cli.end()
if (!rows.length) { console.log('nenhuma credencial cadastrada — nao da para provar'); process.exit(1) }
const cred = rows[0]
console.log('credencial:', String(cred.id).slice(0, 8) + '…', '| conector:', cred.conector_id)

const chamar = async (rota) => {
  const r = await fetch(BASE + rota, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-radar-token': TOKEN },
    body: JSON.stringify({ credencialId: cred.id }),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})) }
}

let iniciou
try {
  console.log('\n--- POST /session (o que a Vercel faz) ---')
  iniciou = await chamar('/session')
  console.log('  HTTP', iniciou.status)
  const url = iniciou.corpo.embedUrl ?? iniciou.corpo.liveUrl ?? iniciou.corpo.url
  console.log('  embedUrl:', url ? url.replace(/\/live\/[0-9a-f]{8}[0-9a-f]*/, '/live/********') : JSON.stringify(iniciou.corpo).slice(0, 200))
  if (!url) process.exit(1)

  console.log('\n--- GET nessa URL (o que o IFRAME faz) — era aqui que morria ---')
  const r = await fetch(url)
  const txt = await r.text()
  const t = txt.match(/<title[^>]*>([^<]{0,90})/i)
  console.log('  HTTP', r.status, '·', r.headers.get('content-type'), '·', txt.length, 'bytes')
  console.log('  <title>:', t ? t[1].trim() : '(sem title)')
  console.log('  tem canvas/stream:', /canvas|<img/i.test(txt))

  // O player carregar NÃO basta: ele traz o endereço do websocket cravado com o
  // endereço interno do container. Se isto não for reescrito, a moldura aparece e
  // fica "Session not connected" — foi exatamente o que o cliente viu.
  console.log('\n--- o websocket do player foi reescrito? ---')
  const interno = txt.match(/wss?:\/\/(?:0\.0\.0\.0|localhost|127\.0\.0\.1):3000[^'"]*/g)
  const externo = txt.match(/wss?:\/\/[^'"]*\/live\/[^'"]*\/v1\/sessions\/cast/g)
  console.log('  sobrou endereço interno:', interno ? 'SIM — ' + interno[0] + '  <<< DEFEITO' : 'não')
  console.log('  aponta para o túnel    :', externo ? externo[0].replace(/\/live\/[^/]+/, '/live/********') : 'NÃO ENCONTRADO  <<< DEFEITO')
  if (interno || !externo) { console.log('\n  A MOLDURA VAI APARECER E FICAR "Session not connected".') }

  // Reescrever o endereço não prova que ele FUNCIONA. Este é o teste que separa
  // "a moldura aparece" de "a tela do gov.br aparece": abrir o websocket pelo túnel,
  // atravessando o proxy de upgrade, como o navegador do fornecedor faz.
  if (externo) {
    console.log('\n--- o websocket conecta MESMO pelo túnel? ---')
    const wsUrl = externo[0] + '?tabInfo=true'
    const r = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl)
      const fim = setTimeout(() => { try { ws.close() } catch {} ; resolve('ESGOTOU O TEMPO (15s) sem abrir') }, 15000)
      ws.onopen = () => { clearTimeout(fim); resolve('ABRIU') }
      ws.onerror = (e) => { clearTimeout(fim); resolve('ERRO: ' + (e.message ?? 'recusado')) }
      ws.onmessage = (m) => { clearTimeout(fim); resolve('ABRIU e já recebeu ' + String(m.data).length + ' bytes') }
    })
    console.log(' ', r)
    if (!r.startsWith('ABRIU')) console.log('  A MOLDURA VAI APARECER E FICAR "Session not connected".')
  }

  // O live view abrir só prova que a MOLDURA funciona. Falta a pergunta que importa:
  // o que o fornecedor está vendo lá dentro? Duas vezes eu tomei um sinal parcial por
  // prova — o <title> "Compras.gov.br" era o cabeçalho de uma página de erro 404.
  console.log('\n--- o que tem DENTRO do navegador? ---')
  try {
    const { chromium } = await import('playwright')
    // Não use o endpoint CDP cru: o /json/version do steel devolve um
    // webSocketDebuggerUrl com o endereço INTERNO do container, e o Playwright tenta
    // localhost:80 (ECONNREFUSED ::1:80). `cdpUrlDe` rebaseia para o alcançável.
    // Usa a MESMA função que o capturar() usa. Não é detalhe: o capturar() conectava
    // no endpoint cru e morria com ECONNREFUSED ::1:80 — depois de o fornecedor ter
    // digitado senha e 2FA. Exercitar aqui a função do produto é o que transforma esta
    // sonda em prova; uma variante própria só provaria a variante.
    const { cdpUrlDaSessaoViva } = await import('./steel.mjs')
    const cdp = await cdpUrlDaSessaoViva()
    console.log('  CDP usado pelo capturar():', cdp)
    const b = await chromium.connectOverCDP(cdp)
    const ctx = b.contexts()[0]
    const page = ctx?.pages()[0]
    if (!page) { console.log('  (nenhuma página aberta)') }
    else {
      const dentro = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).replace(/\s+/g, ' ')
      const url = page.url()
      console.log('  URL    :', url.slice(0, 90))
      console.log('  título :', await page.title().catch(() => ''))
      console.log('  texto  :', dentro.slice(0, 110))
      const erro404 = /não encontrada|nao encontrada/i.test(dentro)
      const certErr = /chrome-error|ERR_CERT|not private/i.test(url + dentro)
      // O MESMO critério que o capturar() usa, não uma regex improvisada aqui — senão
      // a sonda dá alarme falso (ou, pior, deixa passar) por um motivo diferente do
      // que o sistema de verdade considera.
      const { PORTAIS } = await import('./portais.mjs')
      const emLogin = PORTAIS[cred.conector_id]?.emLogin?.({ url, conteudo: dentro }) ?? null
      // A sessão TEM de nascer sem cookie de ninguém. O steel reaproveita o mesmo
      // Chromium entre sessões, então sem limpeza o próximo fornecedor abre o iframe
      // já logado como o anterior — e a captura grava a sessão do primeiro como
      // credencial do segundo. Medido acontecendo em 13/09/2026.
      //
      // A conferência é por cookie de AUTENTICAÇÃO, não por domínio: a própria tela de
      // login cria um `ASPSESSIONID…` anônimo ao abrir, e contá-lo como vazamento faria
      // a sonda gritar sempre — uma sonda que grita sempre não é lida.
      const st = await ctx.storageState()
      const AUTENTICACAO = /Session_Gov_Br|Govbrid|GovbrUid|TSPD|\.ASPXAUTH|JSESSIONID/i
      const herdados = (st.cookies ?? []).filter((c) => AUTENTICACAO.test(c.name ?? ''))
      console.log('  cookies na sessão recém-aberta:', st.cookies?.length ?? 0,
        '· de AUTENTICAÇÃO herdados:', herdados.length ? `${herdados.length} <<< VAZAMENTO (${herdados.map((c) => c.name).join(', ')})` : '0')
      console.log('  404?', erro404 ? 'SIM <<< DEFEITO' : 'não',
        '· certificado?', certErr ? 'SIM <<< DEFEITO' : 'não',
        '· é tela de login (critério do capturar)?', emLogin === null ? '(portal sem regra)' : emLogin ? 'sim' : 'NÃO <<< suspeito')
    }
    await b.close()
  } catch (e) { console.log('  não deu para inspecionar:', e.message.split('\n')[0]) }

  console.log('\n--- o serviço continua vivo depois disso? ---')
  const vivo = await fetch(BASE + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((x) => x.status).catch((e) => 'MORREU: ' + e.message)
  console.log('  POST sem token ->', vivo, '(401 = vivo e protegido)')
} finally {
  const c = await chamar('/cancel').catch(() => ({ status: '?' }))
  console.log('\ncancelado:', c.status)
}
