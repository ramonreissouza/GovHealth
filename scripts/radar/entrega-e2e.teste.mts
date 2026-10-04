// scripts/radar/entrega-e2e.teste.mts — os jobs radar-notify e radar-resumo contra um
// Postgres DE VERDADE, com o envio ao Resend interceptado (nada sai da máquina).
//
//   docker run -d --rm --name e2e -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=e2e -p 55497:5432 postgres:18-alpine
//   E2E_DATABASE_URL=postgres://postgres:teste@localhost:55497/e2e npm run radar:entrega:e2e
//
// O banco é APAGADO no começo (DROP SCHEMA public). Por isso o teste só aceita host local
// e recusa rodar sem E2E_DATABASE_URL — nunca usa o DATABASE_URL do .env.
//
// Cobre a máquina de estados que mora no SQL dos jobs: expiração, reivindicação, teto por
// pessoa, envio órfão, aviso velho indo para o resumo, um resumo por pessoa por dia e a
// nova chance na hora seguinte quando o Resend falha.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'

const URL_E2E = process.env.E2E_DATABASE_URL
if (!URL_E2E) { console.log('E2E_DATABASE_URL ausente — teste pulado (precisa de um Postgres descartável).'); process.exit(0) }
const host = new URL(URL_E2E).hostname
if (!['localhost', '127.0.0.1'].includes(host)) { console.error(`recuso apagar o banco em ${host}: só localhost`); process.exit(1) }

// Antes de qualquer import do app: o db.ts e o SDK do Resend leem o ambiente na hora do uso.
process.env.DATABASE_URL = URL_E2E
process.env.RESEND_API_KEY = 're_teste_falso'
process.env.RESEND_BASE_URL = 'http://127.0.0.1:9' // porta morta, se o stub abaixo falhar

type Enviado = { to: string; subject: string; html: string }
const enviados: Enviado[] = []
let resendFalha = false
globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
  const u = String(url instanceof Request ? url.url : url)
  if (!u.startsWith('http://127.0.0.1:9/')) throw new Error(`fetch inesperado no teste: ${u}`)
  if (resendFalha) return new Response(JSON.stringify({ name: 'internal_server_error', message: 'falha simulada' }), { status: 500, headers: { 'content-type': 'application/json' } })
  const c = JSON.parse(String(init.body ?? '{}'))
  enviados.push({ to: c.to, subject: c.subject, html: c.html })
  return new Response(JSON.stringify({ id: `t${enviados.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

// Banco limpo + schema real.
const admin = new pg.Client({ connectionString: URL_E2E })
await admin.connect()
await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
for (const arq of ['schema.sql', 'schema-admin.sql', 'schema-equipe.sql', 'schema-radar.sql']) {
  await admin.query(fs.readFileSync(path.join('db', arq), 'utf8'))
}
// A razão social vem do PNCP (resultados), que exige itens/contratações: desliga as FKs
// só nesta conexão. No pool do app o SET poderia cair numa conexão e o INSERT em outra.
await admin.query(`SET session_replication_role = replica`)
await admin.query(`INSERT INTO resultados (numero_controle_pncp, numero_item, ni_fornecedor, nome_fornecedor)
                   VALUES ('x-1', 1, '12345678000190', 'REMORA PRODUTOS PARA SAUDE EIRELI')`)
await admin.end()

const { query } = await import('../../src/lib/db')
const { runRadarNotify } = await import('../../src/jobs/radarNotify')
const { runRadarResumo } = await import('../../src/jobs/radarResumo')

const CLI = 'cliente@exemplo.com'
const OUT = 'outro@exemplo.com'
await query(`INSERT INTO usuarios (id, email, nome, senha_hash, empresa, cnpj)
             VALUES ($1, $1, 'Cliente', 'x', 'Remora Saúde', '12.345.678/0001-90'), ($2, $2, 'Outro', 'x', NULL, NULL)`, [CLI, OUT])
const conector = (await query<{ id: string }>(`SELECT id FROM radar_conectores ORDER BY id LIMIT 1`))[0].id
const proc = (id: string, titular: string, participando = false) =>
  query(`INSERT INTO radar_processos (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, participando, link_portal)
         VALUES ($1, $2, $2, $3, '', $1, $4, $5, 'https://portal.exemplo/' || $1)`, [id, titular, conector, `Pregão ${id}`, participando])
await proc('p-auto', CLI); await proc('p-part', CLI, true); await proc('p-out', OUT)

let seq = 0
async function notif(o: { titular: string; proc: string; texto: string; prioridade?: string; status?: string; idadeMin?: number; enviadoHaMin?: number }) {
  const m = await query<{ id: number }>(
    `INSERT INTO radar_mensagens (msg_hash, titular_id, processo_id, conector_id, cnpj, licitacao_id, texto, categorias, prioridade, horario_origem)
     VALUES ($1, $2, $3, $4, '', $3, $5, '{convocacao}', $6, now() - ($7 || ' minutes')::interval) RETURNING id`,
    [`h${++seq}`, o.titular, o.proc, conector, o.texto, o.prioridade ?? 'alta', String(o.idadeMin ?? 5)])
  await query(
    `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link, status, criado_em, enviado_em)
     VALUES ($1, $2, 'nova_mensagem', $3, $4, $2, 'email', 'x', 'https://portal.exemplo/' || $4, $5,
             now() - ($6 || ' minutes')::interval, CASE WHEN $7::int IS NULL THEN NULL ELSE now() - ($7 || ' minutes')::interval END)`,
    [`n${seq}`, o.titular, m[0].id, o.proc, o.status ?? 'pendente', String(o.idadeMin ?? 5), o.enviadoHaMin ?? null])
  return `n${seq}`
}
const CITA = 'Convoco a REMORA PRODUTOS PARA SAUDE LTDA'
const ids = {
  velho: await notif({ titular: CLI, proc: 'p-auto', texto: CITA, idadeMin: 3 * 24 * 60 }),
  citaMasParada: await notif({ titular: CLI, proc: 'p-auto', texto: CITA, idadeMin: 8 * 60 }),
  orfao: await notif({ titular: CLI, proc: 'p-auto', texto: 'qualquer', status: 'enviando', enviadoHaMin: 20 }),
  lida: await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'entregue' }),
  terceiro: await notif({ titular: CLI, proc: 'p-auto', texto: 'Convoco a empresa D. GOMES DA SILVA para habilitação' }),
  participando: await notif({ titular: CLI, proc: 'p-part', texto: 'Ficam os licitantes convocados em 2 horas' }),
  citaCnpj: await notif({ titular: CLI, proc: 'p-auto', texto: 'Empresa 12.345.678/0001-90 convocada para amostra' }),
  cnpjFantasma: await notif({ titular: CLI, proc: 'p-auto', texto: 'Processo 12345678, item 0001-90' }),
  outro: await notif({ titular: OUT, proc: 'p-out', texto: 'Convoco a empresa X LTDA' }),
  citaNome: [] as string[],
}
for (let i = 0; i < 5; i++) ids.citaNome.push(await notif({ titular: CLI, proc: 'p-auto', texto: `A REMORA PRODUTOS PARA SAÚDE EIRELI foi convocada (${i})` }))
await query(
  `INSERT INTO radar_notificacoes (id, titular_id, evento, processo_id, destinatario, canal, assunto, corpo, link)
   VALUES ('nl1', $1, 'nova_licitacao', 'p-auto', $1, 'email', 'Monitores', $2, 'https://app/oportunidades?x=1')`,
  [CLI, JSON.stringify({ objeto: 'Aquisição de monitores <b>', uf: 'BA', municipio: 'Salvador', valor: 250000 })])

const status = async () => Object.fromEntries((await query<{ id: string; status: string }>(
  `SELECT id, status FROM radar_notificacoes`)).map((r) => [r.id, r.status]))

// ── radar-notify ─────────────────────────────────────────────────────────────────
await runRadarNotify()
let s = await status()
assert.equal(s[ids.velho], 'expirado', 'mais de 48 h expira')
assert.equal(s[ids.citaMasParada], 'aguardando_resumo', 'citou o cliente, mas parado 8 h: resumo, não aviso')
assert.equal(s[ids.orfao], 'falha', 'envio órfão vira falha, não reenvia')
assert.equal(s[ids.lida], 'entregue', 'lido na tela não é tocado')
assert.equal(s[ids.terceiro], 'aguardando_resumo', 'convocação de terceiro espera o resumo')
assert.equal(s[ids.cnpjFantasma], 'aguardando_resumo', 'números soltos não formam o CNPJ')
assert.equal(s[ids.outro], 'aguardando_resumo')
assert.equal(s.nl1, 'aguardando_resumo')
const imediatos = [ids.participando, ids.citaCnpj, ...ids.citaNome]
assert.equal(imediatos.filter((i) => s[i] === 'enviado').length, 5, 'teto de 5 por pessoa por rodada')
assert.equal(enviados.length, 5)
assert.match(enviados[0].html, /Publicada no portal em \d{2}\/\d{2} às \d{2}:\d{2}/, 'o aviso diz quando a mensagem saiu')

await runRadarNotify()
s = await status()
assert.equal(imediatos.filter((i) => s[i] === 'enviado').length, 7, 'a segunda rodada entrega o resto')
assert.ok(enviados.every((e) => e.to === CLI), 'imediato só para quem é citado')
assert.equal((await runRadarNotify()).pendentes, 0)
assert.equal(enviados.length, 7, 'nada reenviado')

// ── radar-resumo: falha → nova chance → um por dia ───────────────────────────────
resendFalha = true
const f1 = await runRadarResumo()
assert.equal(f1.falhas, 2)
s = await status()
assert.equal(s[ids.terceiro], 'aguardando_resumo', 'falhou: volta para a fila, não espera amanhã')
resendFalha = false
const r2 = await runRadarResumo() // "a hora seguinte"
assert.equal(r2.enviados, 2, 'um resumo por pessoa na nova chance')
s = await status()
for (const k of [ids.terceiro, ids.citaMasParada, ids.cnpjFantasma, ids.outro, 'nl1']) assert.equal(s[k], 'resumido', `${k} no resumo`)
const resumo = enviados.slice(7).find((e) => e.to === CLI)!
assert.match(resumo.subject, /resumo do dia: 3 mensagens e 1 licitação nova/)
assert.match(resumo.html, /&lt;b&gt;/, 'texto do órgão escapado')

await notif({ titular: CLI, proc: 'p-auto', texto: 'Sessão retomada às 14h', prioridade: 'baixa' })
await runRadarNotify()
const r3 = await runRadarResumo()
assert.equal(r3.enviados, 0, 'já recebeu hoje: o que chegou depois fica para amanhã')

console.log(`OK: ${enviados.length} e-mails gerados, todos interceptados`)
process.exit(0)
