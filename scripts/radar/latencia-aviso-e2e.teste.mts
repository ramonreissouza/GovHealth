// scripts/radar/latencia-aviso-e2e.teste.mts — a aba Aviso do admin
// (src/lib/radar/latencia-aviso.ts) contra um Postgres DE VERDADE, com as armadilhas que
// apareceram nos dados de produção (out/2026) e na revisão da #59: o chat antigo da
// primeira leitura, a hora do portal no futuro (fuso do PCP), a tentativa que não chegou
// a ninguém, a falha lida depois na tela, o repasse, a fila parada e o coletor parado.
//
//   docker run -d --rm --name e2e -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=e2e -p 55493:5432 postgres:18-alpine
//   E2E_DATABASE_URL=postgres://postgres:teste@localhost:55493/e2e npm run radar:aviso:e2e
//
// O banco é APAGADO no começo. Só aceita host local.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import pg from 'pg'

const URL_E2E = process.env.E2E_DATABASE_URL
if (!URL_E2E) { console.log('E2E_DATABASE_URL ausente — teste pulado (precisa de um Postgres descartável).'); process.exit(0) }
const host = new URL(URL_E2E).hostname
if (!['localhost', '127.0.0.1'].includes(host)) { console.error(`recuso apagar o banco em ${host}: só localhost`); process.exit(1) }
process.env.DATABASE_URL = URL_E2E

const db = new pg.Client({ connectionString: URL_E2E })
await db.connect()
await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
for (const arq of ['schema.sql', 'schema-admin.sql', 'schema-radar.sql']) await db.query(fs.readFileSync(path.join('db', arq), 'utf8'))
// A saúde do portal público (credencial_id NULL) vem desta migration, como em produção.
execFileSync(process.execPath, ['scripts/migrate-radar-saude-publica.mjs'], { env: { ...process.env, DATABASE_URL: URL_E2E }, stdio: 'pipe' })

await db.query(`
  INSERT INTO radar_processos (id, titular_id, user_id, conector_id, cnpj, licitacao_id) VALUES
    ('p-bll', 't1', 't1', 'bll', '1', 'L1'), ('p-pcp', 't1', 't1', 'pcp', '1', 'L2');
  -- t0 de cada mensagem = capturado_em; horario_origem = t0 - atraso.
  INSERT INTO radar_mensagens (id, msg_hash, titular_id, processo_id, conector_id, cnpj, licitacao_id, texto, horario_origem, capturado_em) VALUES
    -- BLL: a primeira leitura (há 3 dias) trouxe uma mensagem de 40 dias atrás — histórico, fora da conta.
    (1, 'h1', 't1', 'p-bll', 'bll', '1', 'L1', 'antiga', now() - interval '40 days', now() - interval '3 days'),
    (2, 'h2', 't1', 'p-bll', 'bll', '1', 'L1', 'nova 30 s', now() - interval '2 days' - interval '30 seconds', now() - interval '2 days'),
    (3, 'h3', 't1', 'p-bll', 'bll', '1', 'L1', 'nova 10 min', now() - interval '1 day' - interval '600 seconds', now() - interval '1 day'),
    -- PCP: histórico na primeira leitura; uma "nova" com a hora 5 h depois da leitura (o fuso).
    (4, 'h4', 't1', 'p-pcp', 'pcp', '1', 'L2', 'antiga', now() - interval '10 days', now() - interval '2 days'),
    (5, 'h5', 't1', 'p-pcp', 'pcp', '1', 'L2', 'fuso', now() - interval '30 hours' + interval '5 hours', now() - interval '30 hours'),
    (6, 'h6', 't1', 'p-pcp', 'pcp', '1', 'L2', 'nova 40 s', now() - interval '20 hours' - interval '40 seconds', now() - interval '20 hours');

  INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, status, erro, tentativas,
                                  criado_em, enviado_em, confirmado_em) VALUES
    -- chegou: envio 120 s, ponta a ponta 150 s, "Vi" 300 s depois
    ('n2', 't1', 'nova_mensagem', 2, 'p-bll', 'a@x', 'email', 'enviado', NULL, 1,
       now() - interval '2 days' + interval '5 seconds', now() - interval '2 days' + interval '120 seconds', now() - interval '2 days' + interval '420 seconds'),
    -- chegou e foi lido na tela (status vira 'entregue', e-mail aceito): envio 200 s, ponta 230 s, "Vi" 100 s
    ('n8', 't1', 'nova_mensagem', 2, 'p-bll', 'c@x', 'email', 'entregue', NULL, 1,
       now() - interval '2 days' + interval '5 seconds', now() - interval '2 days' + interval '200 seconds', now() - interval '2 days' + interval '300 seconds'),
    -- a tentativa de 60 s NÃO chegou a ninguém: fora das latências, no contador de falhas
    ('n3', 't1', 'nova_mensagem', 3, 'p-bll', 'a@x', 'email', 'falha', 'resend: 500', 1,
       now() - interval '1 day', now() - interval '1 day' + interval '60 seconds', NULL),
    -- falhou e depois foi lido na tela: o status vira 'entregue', mas o e-mail não saiu (erro)
    ('n7', 't1', 'nova_mensagem', 3, 'p-bll', 'd@x', 'email', 'entregue', 'resend: 500', 1,
       now() - interval '1 day', now() - interval '1 day' + interval '45 seconds', now() - interval '1 day' + interval '2 hours'),
    -- ainda enviando (tentativa sem fim): fora de tudo
    ('n9', 't1', 'nova_mensagem', 2, 'p-bll', 'e@x', 'email', 'enviando', NULL, 0,
       now() - interval '2 days', now() - interval '2 days' + interval '10 seconds', NULL),
    -- aviso de mensagem ANTIGA: o envio (30 s) conta, o ponta a ponta não
    ('n1', 't1', 'nova_mensagem', 1, 'p-bll', 'a@x', 'email', 'enviado', NULL, 1,
       now() - interval '3 days', now() - interval '3 days' + interval '30 seconds', NULL),
    -- o repasse do n3 não é aviso novo
    ('esc:n3', 't1', 'escalonamento', 3, 'p-bll', 'b@x', 'email', 'enviado', NULL, 1,
       now() - interval '1 day' + interval '70 seconds', now() - interval '1 day' + interval '70 seconds', NULL),
    -- na fila, sem envio, desde 20 h atrás
    ('n6', 't1', 'nova_mensagem', 6, 'p-pcp', 'a@x', 'email', 'pendente', NULL, 0, now() - interval '20 hours', NULL, NULL),
    -- a cópia da tela (in_app) não é aviso de e-mail
    ('n6-app', 't1', 'nova_mensagem', 6, 'p-pcp', 'a@x', 'in_app', 'entregue', NULL, 0, now() - interval '20 hours', NULL, now());

  -- Passadas do coletor: o BLL passou há 2 h sem achar nada (pregão calado, não é parada);
  -- o PCP passou há 1 h e falhou (o último OK foi há 30 h).
  INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, tentado_em, verificado_em) VALUES
    (NULL, 't1', 'bll', 'ok', now() - interval '2 hours', now() - interval '2 hours'),
    (NULL, 't1', 'pcp', 'falha', now() - interval '1 hour', now() - interval '30 hours');
`)

const { painelAviso } = await import('../../src/lib/radar/latencia-aviso')
const d = await painelAviso(7)

// Captura das mensagens novas: 30 s, 600 s, 40 s. A do fuso fica fora e é contada.
assert.equal(d.captura.n, 3, 'só mensagem nova entra: o histórico da primeira leitura não')
assert.equal(d.captura.p50, 40)
assert.equal(d.captura.p95, 544, 'percentile_cont(0.95) de 30, 40, 600')
assert.equal(d.captura.naMeta, 2 / 3)
assert.equal(d.captura.futuro, 1, 'hora do portal depois da leitura: fora da conta, contada à parte')

// Envio (leitura → aviso), SÓ o que chegou: n1 30, n2 120, n8 200. A falha (n3), a falha
// lida na tela (n7) e o 'enviando' (n9) não entram; a falha vai para o contador.
assert.deepEqual([d.envio.n, d.envio.p50, d.envio.p95, d.envio.falhas], [3, 120, 192, 1],
  'tentativa que não chegou a ninguém não melhora o p95')
// Ponta a ponta: avisos que chegaram, de mensagem nova: 150 e 230.
assert.deepEqual([d.pontaAPonta.n, d.pontaAPonta.p50, d.pontaAPonta.naMeta], [2, 190, 0])
assert.ok(Math.abs(d.pontaAPonta.p95! - 226) <= 1, `p95 de 150 e 230 (${d.pontaAPonta.p95})`)
// "Vi": 300 e 100 s, de 3 que chegaram (n1, n2, n8).
assert.deepEqual([d.vi.n, d.vi.p50, d.vi.enviados], [2, 200, 3])
assert.equal(d.repasses, 1)

const bll = d.porPortal.find((p) => p.conector === 'bll')!
const pcp = d.porPortal.find((p) => p.conector === 'pcp')!
assert.deepEqual([bll.captura.n, bll.futuro, bll.captura.p95, bll.pontaAPonta.n], [2, 0, 572, 2])
assert.deepEqual([pcp.captura.n, pcp.futuro, pcp.captura.p50, pcp.pontaAPonta.n], [1, 1, 40, 0])
assert.ok(bll.nome && bll.nome !== 'bll', 'nome do portal, não o id')
// Situação vem da passada (radar_saude), não da mensagem.
assert.equal(bll.situacao, 'ok')
assert.equal(pcp.situacao, 'falha')
assert.ok(pcp.ultimoOk && pcp.ultimaTentativa && new Date(pcp.ultimoOk) < new Date(pcp.ultimaTentativa))
assert.ok(bll.ultimaMensagem && new Date(bll.ultimaMensagem) < new Date(bll.ultimaTentativa!), 'última mensagem ≠ última passada')

const status = Object.fromEntries(d.porStatus.map((s) => [s.status, s.n]))
assert.deepEqual(status, { enviado: 2, entregue: 2, falha: 1, enviando: 1, pendente: 1 }, 'só e-mail de nova_mensagem; repasse e in_app fora')
assert.equal(d.fila.pendentes, 1)
assert.ok(d.fila.maisAntigoMin! >= 1199 && d.fila.maisAntigoMin! <= 1201, `fila parada há ~20 h (${d.fila.maisAntigoMin} min)`)
// Série por dia de Brasília: quantos dias depende da hora em que o teste roda.
assert.ok(d.serie.length >= 2 && d.serie.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.dia)), JSON.stringify(d.serie))
assert.equal(d.serie.reduce((t, s) => t + s.novas, 0), 4, 'as 3 novas + a do fuso (que conta como mensagem, não como atraso)')
assert.ok(d.serie.some((s) => s.pontaP95 != null))

// Coletor: a última mensagem é de 20 h atrás, mas houve passada há 1 h. NÃO está parado.
assert.ok(Math.abs(d.semTentativaHaMin! - 60) <= 1, `última passada há ${d.semTentativaHaMin} min`)

// Período: em 1 dia só sobra a mensagem de 20 h atrás. Ela segue NOVA: a primeira leitura
// do pregão (2 dias atrás) vale mesmo fora da janela.
const hoje = await painelAviso(1)
assert.deepEqual([hoje.captura.n, hoje.captura.futuro, hoje.captura.p50, hoje.envio.n], [1, 0, 40, 0])
// O BLL não leu nada novo hoje e continua na lista: portal calado não pode sumir.
const bllHoje = hoje.porPortal.find((p) => p.conector === 'bll')
assert.ok(bllHoje && bllHoje.captura.n === 0 && bllHoje.ultimaTentativa, 'portal sem mensagem no período segue listado, com a última passada')
assert.equal((await painelAviso(0)).dias, 7, 'sem período: 7 dias')
assert.equal((await painelAviso(500)).dias, 90, 'teto de 90 dias')

// Coletor parado de verdade: nenhuma passada há 10 h.
await db.query(`UPDATE radar_saude SET tentado_em = now() - interval '10 hours'`)
assert.ok(Math.abs((await painelAviso(7)).semTentativaHaMin! - 600) <= 1)
await db.end()

console.log('OK: latência do Aviso por etapa, só o que chegou, histórico e hora no futuro fora da conta, repasse, fila e coletor conferidos')
process.exit(0)
