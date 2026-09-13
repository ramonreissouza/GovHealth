// Prova do caminho COMPLETO do live view: o que quebrou na tentativa do cliente.
// Faz o que a app faz — POST /session com o token interno — e depois busca a URL
// devolvida exatamente como o iframe buscaria. Cancela no fim, sempre.
import fs from 'node:fs'
import pg from 'pg'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
)

const TOKEN = env.RADAR_CONNECT_TOKEN
const BASE = 'http://127.0.0.1:3200'

const cli = new pg.Client({ connectionString: env.DATABASE_URL })
await cli.connect()
const { rows } = await cli.query(
  `SELECT id, conector_id FROM radar_credenciais ORDER BY criado_em DESC LIMIT 1`,
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

  console.log('\n--- o serviço continua vivo depois disso? ---')
  const vivo = await fetch(BASE + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((x) => x.status).catch((e) => 'MORREU: ' + e.message)
  console.log('  POST sem token ->', vivo, '(401 = vivo e protegido)')
} finally {
  const c = await chamar('/cancel').catch(() => ({ status: '?' }))
  console.log('\ncancelado:', c.status)
}
