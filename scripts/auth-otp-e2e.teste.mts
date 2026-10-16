// scripts/auth-otp-e2e.teste.mts — código de acesso (2FA) contra um Postgres DE VERDADE:
// consumo atômico do código, teto de tentativas sob concorrência, reenvio bloqueado depois
// de 5 erros e falha do provedor de e-mail sem perder o código anterior (revisão da #68).
//
//   docker run -d --rm --name e2e -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=auth_e2e -p 55494:5432 postgres:18-alpine
//   ALLOW_DESTRUCTIVE_E2E=apagar-banco-descartavel \
//   E2E_DATABASE_URL=postgres://postgres:teste@localhost:55494/auth_e2e npm run auth:otp:e2e
//
// O banco é APAGADO no começo. A guarda (scripts/lib/e2e-guarda.mjs) exige host local, nome
// do banco terminado em _e2e (lido do servidor) e a confirmação acima — um port-forward para
// a produção também é localhost. Nenhum e-mail sai da máquina.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { conferirHostE2E, exigirBancoDescartavel } from './lib/e2e-guarda.mjs'

const URL_E2E = process.env.E2E_DATABASE_URL
if (!URL_E2E) { console.log('E2E_DATABASE_URL ausente — teste pulado (precisa de um Postgres descartável).'); process.exit(0) }
try { conferirHostE2E(URL_E2E) } catch (e) { console.error((e as Error).message); process.exit(1) }

// Antes de qualquer import do app: o db.ts e o SDK do Resend leem o ambiente na hora do uso.
process.env.DATABASE_URL = URL_E2E
process.env.RESEND_API_KEY = 're_teste_falso'
process.env.RESEND_BASE_URL = 'http://127.0.0.1:9' // porta morta, se o stub abaixo falhar

// Resend trocado por um gravador; `resendFalha` simula o provedor fora do ar.
const codigos: string[] = []
let resendFalha = false
globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
  const u = String(url instanceof Request ? url.url : url)
  if (!u.startsWith('http://127.0.0.1:9/')) throw new Error(`fetch inesperado no teste: ${u}`)
  if (resendFalha) return new Response(JSON.stringify({ name: 'internal_server_error', message: 'falha simulada' }), { status: 500, headers: { 'content-type': 'application/json' } })
  const html = String(JSON.parse(String(init.body ?? '{}')).html ?? '')
  const m = html.match(/letter-spacing:6px[^>]*>(\d{6})</)
  assert.ok(m, 'o e-mail traz o código de 6 dígitos')
  codigos.push(m[1])
  return new Response(JSON.stringify({ id: `t${codigos.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

// Banco limpo + schema real (usuarios, colunas do OTP e a migration desta PR, duas vezes:
// o deploy repete migrations e a segunda não pode falhar).
const admin = new pg.Client({ connectionString: URL_E2E })
await admin.connect()
try { await exigirBancoDescartavel(admin) } catch (e) { console.error((e as Error).message); await admin.end(); process.exit(1) }
await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
for (const arq of ['schema-admin.sql', 'schema-equipe.sql']) {
  await admin.query(fs.readFileSync(path.join('db', arq), 'utf8'))
}
for (let i = 0; i < 2; i++) execFileSync(process.execPath, ['scripts/migrate-auth.mjs'], { env: { ...process.env, DATABASE_URL: URL_E2E }, stdio: 'pipe' })

const USER = { id: 'otp@teste.local', email: 'otp@teste.local', nome: 'Teste OTP' }
await admin.query(`INSERT INTO usuarios (id, email, nome, senha_hash) VALUES ($1, $1, $2, 'x')`, [USER.id, USER.nome])

const { enviarOtp, verificarOtp } = await import('../src/lib/seguranca')

const estado = async () => (await admin.query(
  `SELECT otp_hash, otp_tentativas, otp_expira > now() AS valido FROM usuarios WHERE id=$1`, [USER.id])).rows[0]
/** Simula a passagem do tempo sem dormir: o último envio foi há `seg` segundos. */
const envioHa = (seg: number) => admin.query(
  `UPDATE usuarios SET otp_enviado_em = now() - make_interval(secs => $2) WHERE id=$1`, [USER.id, seg])
const zerar = () => admin.query(
  `UPDATE usuarios SET otp_hash=NULL, otp_expira=NULL, otp_tentativas=0, otp_enviado_em=NULL WHERE id=$1`, [USER.id])
const errado = (certo: string) => (certo === '000000' ? '111111' : '000000')
const ultimo = () => codigos[codigos.length - 1]

// ── 1. O mesmo código certo, em paralelo: só UM pedido entra ───────────────────────────
assert.equal((await enviarOtp(USER)).status, 'enviado')
const c1 = ultimo()
const paralelos = await Promise.all(Array.from({ length: 8 }, () => verificarOtp(USER.id, c1)))
assert.equal(paralelos.filter(Boolean).length, 1, 'o código só abre uma sessão')
assert.equal((await estado()).otp_hash, null, 'consumido')
console.log('ok 1 — código certo em paralelo: 1 de 8 aceito')

// ── 2. Chutes errados em paralelo não passam do teto de 5 ──────────────────────────────
await zerar()
assert.equal((await enviarOtp(USER)).status, 'enviado')
const c2 = ultimo()
const chutes = await Promise.all(Array.from({ length: 12 }, () => verificarOtp(USER.id, errado(c2))))
assert.ok(chutes.every((v) => v === false))
assert.equal((await estado()).otp_tentativas, 5, 'o contador para em 5 mesmo com 12 chutes simultâneos')
assert.equal(await verificarOtp(USER.id, c2), false, 'com o teto atingido, nem o código certo passa')
console.log('ok 2 — 12 chutes simultâneos: contador parou em 5')

// ── 3. Cinco erros → 60 s → reenvio: recusado, sem e-mail, com o tempo até liberar ─────
await envioHa(61)
const antes = codigos.length
const bloq = await enviarOtp(USER)
assert.equal(bloq.status, 'bloqueado')
assert.ok(bloq.status === 'bloqueado' && bloq.segundos > 0 && bloq.segundos <= 600)
assert.equal(codigos.length, antes, 'nenhum código inútil é enviado')
// Vencido o código bloqueado, o reenvio volta a funcionar, com contador novo, e o código entra.
await admin.query(`UPDATE usuarios SET otp_expira = now() - interval '1 second' WHERE id=$1`, [USER.id])
assert.equal((await enviarOtp(USER)).status, 'enviado')
assert.equal((await estado()).otp_tentativas, 0)
assert.equal(await verificarOtp(USER.id, ultimo()), true)
console.log('ok 3 — 5 erros → reenvio recusado até o código vencer; depois, código novo entra')

// ── 4. Reenvio antes de 60 s: 'aguarde', e o código anterior continua valendo ──────────
await zerar()
assert.equal((await enviarOtp(USER)).status, 'enviado')
const c4 = ultimo()
const cedo = await enviarOtp(USER)
assert.equal(cedo.status, 'aguarde')
assert.equal(await verificarOtp(USER.id, c4), true)
// Três reenvios simultâneos: um grava, os outros esperam.
await zerar()
const simult = await Promise.all([enviarOtp(USER), enviarOtp(USER), enviarOtp(USER)])
assert.equal(simult.filter((r) => r.status === 'enviado').length, 1)
assert.equal(simult.filter((r) => r.status === 'aguarde').length, 2)
console.log('ok 4 — reenvio cedo: aguarde; 3 simultâneos: 1 envia')

// ── 4b. Código usado no navegador A → login no B logo em seguida: código novo na hora ──
await zerar()
assert.equal((await enviarOtp(USER)).status, 'enviado')
assert.equal(await verificarOtp(USER.id, ultimo()), true) // consumido em A
const noB = await enviarOtp(USER) // B pede dentro dos 60 s
assert.equal(noB.status, 'enviado', 'sem código válido esperando, o intervalo não pode segurar o envio')
assert.equal(await verificarOtp(USER.id, ultimo()), true, 'o código novo do B entra')
console.log('ok 4b — código consumido em A: B recebe código novo sem esperar o intervalo')

// ── 5. Provedor falha: o código anterior segue válido e dá para tentar de novo na hora ─
await zerar()
assert.equal((await enviarOtp(USER)).status, 'enviado')
const c5 = ultimo()
assert.equal(await verificarOtp(USER.id, errado(c5)), false) // 1 erro antes da falha
await envioHa(61)
resendFalha = true
assert.equal((await enviarOtp(USER)).status, 'falhou')
resendFalha = false
const depois = await estado()
assert.ok(depois.valido, 'o código anterior foi restaurado')
assert.equal(depois.otp_tentativas, 1, 'o erro anterior não é esquecido')
assert.equal(await verificarOtp(USER.id, c5), true, 'o código anterior ainda entra')
// Sem código anterior: a falha não deixa intervalo de reenvio, a nova tentativa é imediata.
await zerar()
resendFalha = true
assert.equal((await enviarOtp(USER)).status, 'falhou')
resendFalha = false
assert.equal((await estado()).otp_hash, null, 'nenhum código fantasma (que nunca chegou) fica gravado')
assert.equal((await enviarOtp(USER)).status, 'enviado', 'tentar de novo na hora funciona')
assert.equal(await verificarOtp(USER.id, ultimo()), true)
console.log('ok 5 — falha da Resend: código anterior preservado, reenvio liberado na hora')

await admin.end()
console.log('OK: código de acesso atômico e resiliente')
process.exit(0)
