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
process.env.NEXTAUTH_SECRET = 'segredo-so-do-teste' // assina o link "Vi"

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

// Push: chaves VAPID de mentira e o envio trocado por um gravador. Nada sai da máquina.
const webpush = (await import('web-push')).default
const vapid = webpush.generateVAPIDKeys()
process.env.VAPID_PUBLIC_KEY = vapid.publicKey
process.env.VAPID_PRIVATE_KEY = vapid.privateKey
const pushes: { endpoint: string; aviso: { titulo: string; corpo: string; vi?: string; url: string } }[] = []
let pushFora = false
let tentouVencido = 0
webpush.sendNotification = (async (sub: { endpoint: string }, payload?: string | Buffer | null) => {
  if (sub.endpoint.includes('vencido')) { tentouVencido++; throw Object.assign(new Error('gone'), { statusCode: 410 }) }
  if (pushFora) throw Object.assign(new Error('falha simulada'), { statusCode: 500 })
  pushes.push({ endpoint: sub.endpoint, aviso: JSON.parse(String(payload)) })
  return { statusCode: 201, body: '', headers: {} }
}) as unknown as typeof webpush.sendNotification
const EP_MEMBRO = 'https://fcm.googleapis.com/fcm/send/membro'

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
// A equipe do cliente tem mais uma pessoa (o repasse vai para ela); a do OUT é só ele.
const MEM = 'membro@exemplo.com'
await query(`INSERT INTO usuarios (id, email, nome, senha_hash, titular_id) VALUES ($1, $1, 'Membro', 'x', $2)`, [MEM, CLI])
// O membro ativou o aviso no celular; o cliente tem uma inscrição que o navegador já descartou.
await query(
  `INSERT INTO push_inscricoes (endpoint, user_id, titular_id, p256dh, auth, aparelho)
   VALUES ($1, $2, $3, 'k', 'a', 'Chrome no Android'), ('https://fcm.googleapis.com/fcm/send/vencido', $3, $3, 'k', 'a', 'antigo')`,
  [EP_MEMBRO, MEM, CLI])
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
  // Envio interrompido há 3 h: fora da janela do repasse (o mais novo seria repassado).
  orfao: await notif({ titular: CLI, proc: 'p-auto', texto: 'qualquer', status: 'enviando', enviadoHaMin: 180 }),
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
assert.match(enviados[0].html, /\/api\/radar\/vi\?t=[\w.-]+/, 'o aviso traz o botão "Vi"')
assert.match(enviados[0].html, /vai para outra pessoa da equipe/, 'e avisa que repassa: a equipe tem mais alguém')
assert.equal(pushes.length, 0, 'o cliente não tem aparelho válido')
assert.equal((await query(`SELECT 1 FROM push_inscricoes WHERE endpoint LIKE '%vencido' AND vencida_em IS NOT NULL`)).length, 1,
  'inscrição vencida (410) é marcada, não apagada: a renovação do navegador ainda precisa achá-la')
assert.equal(tentouVencido, 1)

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

// ── "Vi" e repasse ───────────────────────────────────────────────────────────────
const semVi = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 20 })
const visto = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 20 })
const recente = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 5 })
const antigo = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 180, idadeMin: 185 })
const sozinho = await notif({ titular: OUT, proc: 'p-out', texto: 'Convoco a empresa X LTDA', status: 'enviado', enviadoHaMin: 20 })

const { GET, POST } = await import('../../src/app/api/radar/vi/route')
const { NextRequest } = await import('next/server')
const { tokenVi } = await import('../../src/lib/radar/vi-token')
const tok = tokenVi(visto)
const confirmado = async (id: string) => (await query<{ c: string | null }>(`SELECT confirmado_em AS c FROM radar_notificacoes WHERE id = $1`, [id]))[0].c
// Abrir o link (o que o antivírus do e-mail faz sozinho) NÃO confirma: só mostra o botão.
const pg1 = await GET(new NextRequest(`http://localhost/api/radar/vi?t=${encodeURIComponent(tok)}`))
assert.equal(pg1.status, 200)
assert.match(await pg1.text(), /Vi, estou cuidando/)
assert.equal(await confirmado(visto), null, 'GET não confirma')
const fd = new FormData(); fd.set('t', tok)
const pg2 = await POST(new NextRequest('http://localhost/api/radar/vi', { method: 'POST', body: fd }))
assert.equal(pg2.status, 200)
assert.ok(await confirmado(visto), 'POST confirma')
const msgVista = (await query<{ lida: boolean; lida_por: string | null }>(
  `SELECT m.lida, m.lida_por FROM radar_mensagens m JOIN radar_notificacoes n ON n.mensagem_id = m.id WHERE n.id = $1`, [visto]))[0]
assert.deepEqual(msgVista, { lida: true, lida_por: CLI }, 'a mensagem fica lida, por quem recebeu')
const fd2 = new FormData(); fd2.set('t', tok.slice(0, -3) + 'xyz')
assert.equal((await POST(new NextRequest('http://localhost/api/radar/vi', { method: 'POST', body: fd2 }))).status, 400, 'token adulterado')

const antesRepasse = enviados.length
const rr = await runRadarNotify()
assert.equal(rr.repassados, 1, 'só o sem "Vi", dentro da janela, depois do SLA')
assert.equal(rr.semEquipe, 1, 'equipe de uma pessoa: marca, não manda')
const repasse = enviados.slice(antesRepasse)
assert.equal(repasse.length, 1)
assert.equal(repasse[0].to, MEM, 'vai para o outro membro, não para quem já recebeu')
assert.equal(pushes.length, 1, 'e chega no celular do membro')
assert.equal(pushes[0].endpoint, EP_MEMBRO)
assert.match(pushes[0].aviso.titulo, /^⚠️ Sem resposta: Pregão p-auto$/)
assert.match(pushes[0].aviso.vi ?? '', /\/api\/radar\/vi\?t=/, 'a notificação tem o botão "Vi"')
assert.equal(rr.push, 1)
assert.match(repasse[0].subject, /^⚠️ Sem resposta — /)
assert.match(repasse[0].html, /Ninguém confirmou este aviso em 2\d min\. Ele foi para cliente@exemplo\.com/)
assert.match(repasse[0].html, /\/api\/radar\/vi\?t=/, 'o repasse também tem "Vi"')
const esc = Object.fromEntries((await query<{ id: string; escalonado_para: string | null; escalonado_em: string | null }>(
  `SELECT id, escalonado_para, escalonado_em FROM radar_notificacoes WHERE id = ANY($1::text[])`,
  [[semVi, visto, recente, antigo, sozinho]])).map((r) => [r.id, r]))
assert.equal(esc[semVi].escalonado_para, MEM)
assert.equal(esc[visto].escalonado_em, null, 'quem deu "Vi" não é repassado')
assert.equal(esc[recente].escalonado_em, null, 'antes dos 15 min, espera')
assert.equal(esc[antigo].escalonado_em, null, 'fora da janela de 2 h: não repassa o acúmulo antigo')
assert.ok(esc[sozinho].escalonado_em && esc[sozinho].escalonado_para === null)
assert.equal((await query<{ s: string }>(`SELECT status AS s FROM radar_notificacoes WHERE id = $1`, [`esc:${semVi}`]))[0].s, 'enviado')
// "Vi" no e-mail repassado confirma o aviso inteiro, inclusive o original.
const fd3 = new FormData(); fd3.set('t', tokenVi(`esc:${semVi}`))
await POST(new NextRequest('http://localhost/api/radar/vi', { method: 'POST', body: fd3 }))
assert.ok(await confirmado(semVi), '"Vi" do repasse confirma o original')
assert.equal((await runRadarNotify()).repassados, 0, 'um repasse por aviso')

// ── aviso que não chegou, repasse que falha, indicação à mão ────────────────────
const MEM2 = 'membro2@exemplo.com'
await query(`INSERT INTO usuarios (id, email, nome, senha_hash, titular_id, criado_em)
             VALUES ($1, $1, 'Membro 2', 'x', $2, now() + interval '1 minute')`, [MEM2, CLI])
const naoChegou = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'falha', enviadoHaMin: 2 })
const indicado = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 20 })
await query(`UPDATE radar_notificacoes SET escalonado_para = $2 WHERE id = $1`, [indicado, MEM2])
const info = async (ids: string[]) => Object.fromEntries((await query<{ id: string; escalonado_em: string | null; escalonado_para: string | null }>(
  `SELECT id, escalonado_em, escalonado_para FROM radar_notificacoes WHERE id = ANY($1::text[])`, [ids])).map((r) => [r.id, r]))

resendFalha = true; pushFora = true // e-mail e push fora do ar: os dois repasses falham
const fora = await runRadarNotify()
pushFora = false
assert.equal(fora.repassados, 0)
assert.equal(fora.falhas, 2)
let est = await info([naoChegou, indicado])
// O estado do repasse mora na linha esc:<id>: 'falha' com tentativa sobrando = candidato de novo.
const escEst = async (id: string) => (await query<{ status: string; tentativas: number }>(
  `SELECT status, tentativas FROM radar_notificacoes WHERE id = $1`, [`esc:${id}`]))[0]
assert.deepEqual(await escEst(naoChegou), { status: 'falha', tentativas: 1 }, 'repasse que falhou fica para a próxima rodada')
assert.deepEqual(await escEst(indicado), { status: 'falha', tentativas: 1 })
assert.equal(est[indicado].escalonado_para, MEM2, 'e guarda quem foi indicado à mão')
resendFalha = false
const antesVolta = enviados.length
assert.equal((await runRadarNotify()).repassados, 2, 'nova chance na rodada seguinte')
const volta = enviados.slice(antesVolta)
const naoEntregue = volta.find((e) => /^⚠️ Aviso não entregue — /.test(e.subject))
assert.ok(naoEntregue, 'aviso imediato que falhou é repassado, sem esperar o SLA')
assert.equal(naoEntregue.to, MEM)
assert.match(naoEntregue.html, /não pôde ser entregue a cliente@exemplo\.com/)
assert.equal(volta.find((e) => /^⚠️ Sem resposta — /.test(e.subject))?.to, MEM2, 'indicado à mão vem antes do membro mais antigo')
assert.equal((await query<{ t: number }>(`SELECT tentativas AS t FROM radar_notificacoes WHERE id = $1`, [`esc:${indicado}`]))[0].t, 2)
est = await info([naoChegou, indicado])
assert.equal(est[indicado].escalonado_para, MEM2)

// A página do "Vi" depois do repasse não promete o que já aconteceu.
const tkRep = tokenVi(indicado)
assert.match(await (await GET(new NextRequest(`http://localhost/api/radar/vi?t=${encodeURIComponent(tkRep)}`))).text(),
  /a equipe fica sabendo que alguém está cuidando/)
const fd5 = new FormData(); fd5.set('t', tkRep)
assert.match(await (await POST(new NextRequest('http://localhost/api/radar/vi', { method: 'POST', body: fd5 }))).text(),
  /já tinha sido repassado para membro2@exemplo\.com/)
const indices = (await query<{ n: string }>(`SELECT indexname AS n FROM pg_indexes WHERE indexname LIKE 'idx_radar_notif_%'`)).map((r) => r.n)
assert.ok(indices.includes('idx_radar_notif_sem_vi'), 'índice do repasse')
assert.ok(!indices.includes('idx_radar_notif_repasse'), 'o índice antigo (#55) é trocado')

// ── e-mail fora, push no ar: o aviso chegou, não é repassado na hora ──────────────
await query(`INSERT INTO push_inscricoes (endpoint, user_id, titular_id, p256dh, auth) VALUES ('https://fcm.googleapis.com/fcm/send/cliente', $1, $1, 'k', 'a')`, [CLI])
const soPush = await notif({ titular: CLI, proc: 'p-auto', texto: CITA })
resendFalha = true
const antesPush = pushes.length
await runRadarNotify()
resendFalha = false
const linhaPush = (await query<{ status: string; erro: string | null }>(`SELECT status, erro FROM radar_notificacoes WHERE id = $1`, [soPush]))[0]
assert.equal(linhaPush.status, 'enviado', 'push entregou: conta como enviado')
assert.ok(linhaPush.erro, 'mas a falha do e-mail fica registrada')
assert.equal(pushes.slice(antesPush).filter((p) => p.endpoint.endsWith('/cliente')).length, 1)
assert.match(pushes[pushes.length - 1].aviso.titulo, /^🔔 Pregão p-auto$/)

// ── repasse interrompido no meio é retomado (revisão da #56) ──────────────────────
// a) a rodada caiu depois de marcar o aviso e antes de criar a linha do repasse
const caiuAntes = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 30 })
await query(`UPDATE radar_notificacoes SET escalonado_em = now() - interval '10 minutes', escalonado_para = $2 WHERE id = $1`, [caiuAntes, MEM])
// b) caiu com o repasse em 'enviando' (worker reiniciado no meio do envio)
const caiuEnviando = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 40 })
await query(`UPDATE radar_notificacoes SET escalonado_em = now() - interval '20 minutes', escalonado_para = $2 WHERE id = $1`, [caiuEnviando, MEM])
const linhaEsc = (id: string, status: string, haMin: number) => query(
  `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, status, enviado_em)
   SELECT 'esc:' || id, titular_id, 'escalonamento', mensagem_id, processo_id, $2, 'email', $3, now() - ($4 || ' minutes')::interval
     FROM radar_notificacoes WHERE id = $1`, [id, MEM, status, String(haMin)])
await linhaEsc(caiuEnviando, 'enviando', 20)
// c) já repassado com sucesso: não repete
const jaFoi = await notif({ titular: CLI, proc: 'p-auto', texto: CITA, status: 'enviado', enviadoHaMin: 50 })
await query(`UPDATE radar_notificacoes SET escalonado_em = now() - interval '30 minutes', escalonado_para = $2 WHERE id = $1`, [jaFoi, MEM])
await linhaEsc(jaFoi, 'enviado', 30)
const antesRet = enviados.length
const ret = await runRadarNotify()
assert.equal(ret.repassados, 2, 'os dois interrompidos são retomados; o que já foi, não')
assert.deepEqual(enviados.slice(antesRet).map((e) => e.to), [MEM, MEM])
assert.equal((await escEst(caiuAntes)).status, 'enviado')
assert.equal((await escEst(caiuEnviando)).status, 'enviado')
assert.equal((await runRadarNotify()).repassados, 0, 'e não repetem')

// ── conta suspensa não recebe push (revisão da #56) ───────────────────────────────
const { enviarPushPara } = await import('../../src/lib/push')
const teste = { titulo: 't', corpo: 'c', url: '/' }
await query(`UPDATE usuarios SET suspenso = true WHERE id = $1`, [MEM])
assert.equal((await enviarPushPara(MEM, teste)).enviados, 0, 'suspensa: nada sai, na hora')
await query(`UPDATE usuarios SET suspenso = false WHERE id = $1`, [MEM])
assert.equal((await enviarPushPara(MEM, teste)).enviados, 1, 'reativada: volta a receber')

// ── só push, sem e-mail (revisão da #56) ──────────────────────────────────────────
await proc('p-out2', OUT, true)
const comAparelho = await notif({ titular: CLI, proc: 'p-auto', texto: CITA })
const semAparelho = await notif({ titular: OUT, proc: 'p-out2', texto: 'Prazo de 2 horas para a proposta ajustada' })
const chaveResend = process.env.RESEND_API_KEY
delete process.env.RESEND_API_KEY
const emailsAntes = enviados.length, pushAntes = pushes.length
const sp = await runRadarNotify()
assert.ok(!('skipped' in sp), 'com push ligado, o job roda sem o e-mail')
assert.equal(sp.semCanal, 1, 'quem não tem aparelho espera o e-mail voltar')
const st2 = await status()
assert.equal(st2[comAparelho], 'enviado', 'saiu por push')
assert.equal(st2[semAparelho], 'pendente', 'continua na fila, intacto')
assert.equal(enviados.length, emailsAntes, 'nenhum e-mail sem a chave')
assert.equal(pushes.slice(pushAntes).filter((p) => p.endpoint.endsWith('/cliente')).length, 1)
const vapidPub = process.env.VAPID_PUBLIC_KEY
delete process.env.VAPID_PUBLIC_KEY
assert.equal((await runRadarNotify() as { skipped?: boolean }).skipped, true, 'sem nenhum canal, nada é tocado')
process.env.VAPID_PUBLIC_KEY = vapidPub
process.env.RESEND_API_KEY = chaveResend
assert.equal((await runRadarNotify()).enviados, 1, 'com o e-mail de volta, o que esperava sai')

// ── renovação da inscrição pela rota, com sessão de verdade (revisão da #56) ─────
const { encode } = await import('next-auth/jwt')
const sessao = await encode({ token: { id: MEM, sub: MEM, email: MEM }, secret: process.env.NEXTAUTH_SECRET! })
const rotaPush = await import('../../src/app/api/push/route')
const pedido = (metodo: string, corpo: object, comSessao = true) => new NextRequest('http://localhost/api/push', {
  method: metodo, body: JSON.stringify(corpo),
  headers: { 'content-type': 'application/json', ...(comSessao ? { cookie: `next-auth.session-token=${sessao}` } : {}) },
})
const inscr = (ep: string) => ({ endpoint: ep, keys: { p256dh: 'BPkx', auth: 'autz' } })
const FCM = 'https://fcm.googleapis.com/fcm/send/'
const doMembro = async () => (await query<{ endpoint: string }>(
  `SELECT endpoint FROM push_inscricoes WHERE user_id = $1 AND vencida_em IS NULL ORDER BY endpoint`, [MEM])).map((r) => r.endpoint)
assert.equal((await rotaPush.POST(pedido('POST', { subscription: inscr(`${FCM}m2`), substitui: EP_MEMBRO }))).status, 200, 'renova a partir da conhecida')
assert.deepEqual(await doMembro(), [`${FCM}m2`], 'a antiga sai, a nova entra')
assert.equal((await rotaPush.POST(pedido('POST', { subscription: inscr(`${FCM}m2`), substitui: EP_MEMBRO }))).status, 200,
  'o service worker chegou antes: a conferência do app não falha')
await rotaPush.DELETE(pedido('DELETE', { endpoint: `${FCM}m2` }))
assert.equal((await rotaPush.POST(pedido('POST', { subscription: inscr(`${FCM}m3`), substitui: `${FCM}m2` }))).status, 409,
  'aparelho removido pela lista não volta sozinho')
await query(`INSERT INTO push_inscricoes (endpoint, user_id, titular_id, p256dh, auth, vencida_em) VALUES ($1, $2, $3, 'k', 'a', now())`, [`${FCM}velho`, MEM, CLI])
assert.equal((await rotaPush.POST(pedido('POST', { subscription: inscr(`${FCM}m4`), substitui: `${FCM}velho` }))).status, 200,
  'renovação depois do 410 é aceita')
assert.deepEqual(await doMembro(), [`${FCM}m4`])
assert.equal((await rotaPush.POST(pedido('POST', { subscription: inscr('https://atacante.com/x') }))).status, 400, 'só serviço de push')
assert.equal((await rotaPush.POST(pedido('POST', { subscription: inscr(`${FCM}m5`) }, false))).status, 401, 'sem sessão')

console.log(`OK: ${enviados.length} e-mails gerados, todos interceptados`)
process.exit(0)
