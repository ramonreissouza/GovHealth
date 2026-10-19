// scripts/auth-revogacao-e2e.teste.mts — um JWT emitido ANTES da revogação, usado DIRETO nas
// APIs (sem heartbeat, sem /api/auth/session, ou seja, sem nunca passar pelo callback jwt que
// marca `revogado`), tem de ser negado pelo proxy e pelo guard do admin (revisão da #68).
//
//   docker run -d --rm --name e2e -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=auth_e2e -p 55494:5432 postgres:18-alpine
//   ALLOW_DESTRUCTIVE_E2E=apagar-banco-descartavel \
//   E2E_DATABASE_URL=postgres://postgres:teste@localhost:55494/auth_e2e npm run auth:revogacao:e2e
//
// O banco é APAGADO no começo (guarda em scripts/lib/e2e-guarda.mjs).
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { conferirHostE2E, exigirBancoDescartavel } from './lib/e2e-guarda.mjs'

const URL_E2E = process.env.E2E_DATABASE_URL
if (!URL_E2E) { console.log('E2E_DATABASE_URL ausente — teste pulado (precisa de um Postgres descartável).'); process.exit(0) }
try { conferirHostE2E(URL_E2E) } catch (e) { console.error((e as Error).message); process.exit(1) }

// Antes de qualquer import do app: db.ts e next-auth leem o ambiente na hora do uso.
process.env.DATABASE_URL = URL_E2E
process.env.NEXTAUTH_SECRET = 'segredo-so-do-teste'
delete process.env.NEXTAUTH_URL // cookie sem __Secure-, como no http local
delete process.env.AUTH_2FA // o authorize da corrida (caso 7) entra só com a senha

const admin = new pg.Client({ connectionString: URL_E2E })
await admin.connect()
try { await exigirBancoDescartavel(admin) } catch (e) { console.error((e as Error).message); await admin.end(); process.exit(1) }
await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
for (const arq of ['schema-admin.sql', 'schema-equipe.sql']) {
  await admin.query(fs.readFileSync(path.join('db', arq), 'utf8'))
}
execFileSync(process.execPath, ['scripts/migrate-auth.mjs'], { env: { ...process.env, DATABASE_URL: URL_E2E }, stdio: 'pipe' })

const contas = ['senha@teste.local', 'suspensa@teste.local', 'excluida@teste.local', 'cache@teste.local', 'legado@teste.local']
for (const id of contas) {
  await admin.query(`INSERT INTO usuarios (id, email, senha_hash, plano, status_assinatura) VALUES ($1, $1, 'x', 'pro', 'ativa')`, [id])
}
// Conta com senha de verdade, para o authorize da corrida (caso 7).
const bcrypt = (await import('bcryptjs')).default
await admin.query(`INSERT INTO usuarios (id, email, senha_hash, plano, status_assinatura) VALUES ('corrida@teste.local', 'corrida@teste.local', $1, 'pro', 'ativa')`,
  [bcrypt.hashSync('SenhaAntiga1', 10)])
await admin.query(`INSERT INTO usuarios (id, email, senha_hash, role, plano, status_assinatura) VALUES ('master@teste.local', 'master@teste.local', 'x', 'master', 'empresa', 'ativa')`)

const { encode } = await import('next-auth/jwt')
const { NextRequest } = await import('next/server')
const { proxy } = await import('../src/proxy')
const { exigirMaster } = await import('../src/lib/admin-guard')
const { limparCacheRevogacao } = await import('../src/lib/revogacao')

/**
 * JWT como o authorize emitiria: senha nunca trocada (senhaVersao 0), login 1 s atrás, sem
 * `revogado`. `legado`: token de antes da senhaVersao existir (só loginEm).
 */
const tokenDe = (id: string, role = 'user', legado = false) => encode({
  secret: process.env.NEXTAUTH_SECRET!,
  token: {
    id, email: id, role, plano: role === 'master' ? 'empresa' : 'pro', status: 'ativa', expiraEm: null, sessaoId: 's',
    loginEm: Date.now() - 1000, rev: Date.now(), ...(legado ? {} : { senhaVersao: 0 }),
  },
})
const pedido = (caminho: string, jwt: string) =>
  new NextRequest(new URL(caminho, 'http://localhost:3000'), { headers: { cookie: `next-auth.session-token=${jwt}` } })
const passou = (r: Response) => r.headers.get('x-middleware-next') === '1'
const cookieApagado = (r: Response) => /next-auth\.session-token=;.*Max-Age=0/i.test(r.headers.get('set-cookie') ?? '')
const revogar = async (sql: string, id: string) => { await admin.query(sql, [id]); limparCacheRevogacao() }

// ── 1. Senha trocada depois do login ───────────────────────────────────────────────────
const t1 = await tokenDe('senha@teste.local')
assert.ok(passou(await proxy(pedido('/api/conta', t1))), 'antes da troca, o token vale')
await revogar(`UPDATE usuarios SET senha_alterada_em = now() WHERE id=$1`, 'senha@teste.local')
const api1 = await proxy(pedido('/api/conta', t1))
assert.equal(api1.status, 401, 'API com o token antigo é negada')
assert.ok(cookieApagado(api1), 'e o cookie é apagado')
const pag1 = await proxy(pedido('/oportunidades', t1))
assert.equal(pag1.status, 307)
assert.match(pag1.headers.get('location') ?? '', /\/login\?motivo=revogada$/)
console.log('ok 1 — senha trocada: API 401 e página → /login?motivo=revogada')

// ── 2. Conta suspensa ──────────────────────────────────────────────────────────────────
const t2 = await tokenDe('suspensa@teste.local')
assert.ok(passou(await proxy(pedido('/api/user-data', t2))))
await revogar(`UPDATE usuarios SET suspenso = true WHERE id=$1`, 'suspensa@teste.local')
assert.equal((await proxy(pedido('/api/user-data', t2))).status, 401)
console.log('ok 2 — conta suspensa: API 401')

// ── 3. Conta excluída (membro removido / LGPD) ─────────────────────────────────────────
const t3 = await tokenDe('excluida@teste.local')
assert.ok(passou(await proxy(pedido('/api/radar/inbox', t3))))
await revogar(`UPDATE usuarios SET deleted_at = now() WHERE id=$1`, 'excluida@teste.local')
assert.equal((await proxy(pedido('/api/radar/inbox', t3))).status, 401)
console.log('ok 3 — conta excluída: API 401')

// ── 4. Master: proxy e exigirMaster (usado por toda rota /api/admin/*) ──────────────────
const tm = await tokenDe('master@teste.local', 'master')
assert.ok(passou(await proxy(pedido('/api/admin/contas', tm))), 'master válido passa no proxy')
assert.ok('token' in (await exigirMaster(pedido('/api/admin/contas', tm))), 'e no guard da rota')
await revogar(`UPDATE usuarios SET senha_alterada_em = now() WHERE id=$1`, 'master@teste.local')
assert.equal((await proxy(pedido('/api/admin/contas', tm))).status, 403)
assert.ok('erro' in (await exigirMaster(pedido('/api/admin/contas', tm))), 'a rota nega mesmo se chamada sem o proxy')
console.log('ok 4 — master com senha trocada: proxy 403 e exigirMaster nega')

// ── 5. Sem limpar o cache: a revogação chega em até 5 s (o cache do "ainda vale") ──────
const t5 = await tokenDe('cache@teste.local')
assert.ok(passou(await proxy(pedido('/api/conta', t5)))) // entra no cache como válido
await admin.query(`UPDATE usuarios SET suspenso = true WHERE id=$1`, ['cache@teste.local'])
await new Promise((r) => setTimeout(r, 5_200))
assert.equal((await proxy(pedido('/api/conta', t5))).status, 401, 'vencido o cache, o token antigo cai')
console.log('ok 5 — sem intervenção no cache: negado em até 5 s')

// ── 6. Rotas públicas seguem abertas para o token revogado (com o cookie apagado) ──────
const pub = await proxy(pedido('/login', t1))
assert.ok(passou(pub) && cookieApagado(pub), '/login abre e limpa o cookie, para entrar de novo')
console.log('ok 6 — /login com token revogado: abre e apaga o cookie')

// ── 7. Corrida: senha validada → trocada → callback jwt conclui. O token já nasce morto ──
// Antes, o token levava loginEm = instante do CALLBACK, posterior à troca, e era aceito embora
// autenticado com a senha revogada (revisão da #68). Agora leva a versão da senha lida na
// mesma consulta que conferiu o hash.
const { authOptions } = await import('../src/lib/auth')
type Cred = { id: string; options: { authorize: (c: Record<string, string>, r: { headers: Record<string, string> }) => Promise<Record<string, unknown> | null> } }
const cred = authOptions.providers.find((p) => p.id === 'credentials') as unknown as Cred
const jwtCallback = authOptions.callbacks!.jwt! as unknown as (a: { token: Record<string, unknown>; user?: unknown }) => Promise<Record<string, unknown>>
const emitirPeloLogin = async (trocarNoMeio: boolean) => {
  const user = await cred.options.authorize({ email: 'corrida@teste.local', password: 'SenhaAntiga1', otp: '' }, { headers: {} })
  assert.ok(user, 'a senha antiga ainda confere no authorize')
  if (trocarNoMeio) { // a "pausa": a troca é confirmada entre a validação e o callback
    await admin.query(`UPDATE usuarios SET senha_hash=$2, senha_alterada_em=now() WHERE id=$1`,
      ['corrida@teste.local', bcrypt.hashSync('SenhaNova123', 10)])
    limparCacheRevogacao()
  }
  const token = await jwtCallback({ token: {}, user })
  return encode({ secret: process.env.NEXTAUTH_SECRET!, token })
}
assert.ok(passou(await proxy(pedido('/api/conta', await emitirPeloLogin(false)))), 'controle: sem troca, o login vale')
const tCorrida = await emitirPeloLogin(true)
assert.equal((await proxy(pedido('/api/conta', tCorrida))).status, 401, 'token autenticado com a senha revogada é negado')
console.log('ok 7 — corrida: senha trocada entre a validação e o callback → token negado')

// ── 8. Token legado (sem senhaVersao) segue a regra do loginEm: cai na troca de senha ───
const tl = await tokenDe('legado@teste.local', 'user', true)
assert.ok(passou(await proxy(pedido('/api/conta', tl))))
await revogar(`UPDATE usuarios SET senha_alterada_em = now() WHERE id=$1`, 'legado@teste.local')
assert.equal((await proxy(pedido('/api/conta', tl))).status, 401)
console.log('ok 8 — token legado (só loginEm): cai na troca de senha')

await admin.end()
console.log('OK: token revogado é negado direto nas APIs, sem depender do navegador')
process.exit(0)
