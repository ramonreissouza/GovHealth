// scripts/pagometro-produto-e2e.teste.mts — Pagômetro no produto (Fase 3), contra um
// Postgres DE VERDADE: a gravação do prazo em contratacoes, o score do SQL igual ao do
// JS, a ordenação e o filtro "paga em até N dias", pela rota /api/opportunities.
//
//   docker run -d --rm --name e2e -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=e2e -p 55493:5432 postgres:18-alpine
//   E2E_DATABASE_URL=postgres://postgres:teste@localhost:55493/e2e npm run pagometro:produto:e2e
//
// O banco é APAGADO no começo. Só aceita host local.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'

const URL_E2E = process.env.E2E_DATABASE_URL
if (!URL_E2E) { console.log('E2E_DATABASE_URL ausente — teste pulado (precisa de um Postgres descartável).'); process.exit(0) }
const host = new URL(URL_E2E).hostname
if (!['localhost', '127.0.0.1'].includes(host)) { console.error(`recuso apagar o banco em ${host}: só localhost`); process.exit(1) }
process.env.DATABASE_URL = URL_E2E

const admin = new pg.Client({ connectionString: URL_E2E })
await admin.connect()
await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
for (const arq of ['schema.sql', 'schema-admin.sql', 'schema-capag.sql']) {
  await admin.query(fs.readFileSync(path.join('db', arq), 'utf8'))
}
// Colunas que migrações à parte acrescentam e a rota lê.
await admin.query(`
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS esfera text;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS codigo_unidade text;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS usuario_nome text;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS link_externo text;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS fonte text DEFAULT 'pncp';
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS tipo_fornecimento text;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS categoria_saude text;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS coletado_em timestamptz DEFAULT now();
`)
// O schema do Pagômetro acrescenta as colunas pagometro_* em contratacoes (Fase 3).
await admin.query(fs.readFileSync(path.join('db', 'schema-pagometro.sql'), 'utf8'))
await admin.query(fs.readFileSync(path.join('db', 'schema-pagometro.sql'), 'utf8')) // idempotente: segunda vez não mexe

// Os resumos que as cargas gravariam.
await admin.query(`
  INSERT INTO pagometro (ente_tipo, uf, municipio_key, municipio_nome, codigo_ibge, dias, dias_saude, meses)
  VALUES ('municipio', 'SP', 'SAO PAULO', 'São Paulo', '3550308', 25, 10, 12),
         ('estado', 'BA', '', NULL, '29', 30, NULL, 12);
  INSERT INTO pagometro_federal (ug, nome, dias, meses) VALUES ('250052', 'INSTITUTO NACIONAL DO CANCER - RJ', 60, 9);
  INSERT INTO capag (ente_tipo, uf, municipio_key, nota) VALUES ('municipio', 'SP', 'SAO PAULO', 'A'), ('estado', 'BA', '', 'C');
`)
const lic = (id: string, orgao: string, mun: string, uf: string, esfera: string | null, ug: string | null) => admin.query(
  `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf, objeto_compra, valor_total_estimado,
                             data_publicacao, esfera, codigo_unidade, fonte)
   VALUES ($1, '00000000000000', $2, $3, $4, 'Aquisição de monitores multiparamétricos', 100000, now(), $5, $6, 'pncp')`,
  [id, orgao, mun, uf, esfera, ug])
await lic('c-mun', 'MUNICIPIO DE SAO PAULO', 'São Paulo', 'SP', 'M', null)
await lic('c-est', 'SECRETARIA DA SAUDE DO ESTADO DA BAHIA', 'Salvador', 'BA', 'E', null)
await lic('c-fed', 'MINISTERIO DA SAUDE', 'Rio de Janeiro', 'RJ', 'F', '250052')
await lic('c-fed-sem', 'MINISTERIO DA SAUDE', 'Rio de Janeiro', 'RJ', 'F', '999999')
await lic('c-cons', 'CONSORCIO INTERMUNICIPAL DE SAUDE DO OESTE', 'Chapecó', 'SC', null, null)
await admin.end()

// ── 1) gravação do prazo em cada contratação ─────────────────────────────────────────
const { novoPool } = await import('./lib/pg-ssl.mjs')
const { atualizarPagometroContratacoes } = await import('./lib/pagometro-contratacoes.mjs')
const pool = novoPool(URL_E2E, { max: 2 })
const r1 = await atualizarPagometroContratacoes(pool, { log: () => {} })
assert.deepEqual(r1, { lidas: 5, comPrazo: 3, alteradas: 3 })
const gravado = Object.fromEntries((await pool.query(
  `SELECT numero_controle_pncp id, pagometro_dias::float8 dias, pagometro_pagador pagador, pagometro_fonte fonte FROM contratacoes`)).rows.map((r) => [r.id, r]))
assert.deepEqual(gravado['c-mun'], { id: 'c-mun', dias: 10, pagador: 'São Paulo/SP', fonte: 'siconfi' }, 'Saúde primeiro (10, não 25)')
assert.deepEqual(gravado['c-est'], { id: 'c-est', dias: 30, pagador: 'Governo do estado (BA)', fonte: 'siconfi' })
assert.deepEqual(gravado['c-fed'], { id: 'c-fed', dias: 60, pagador: 'INSTITUTO NACIONAL DO CANCER - RJ (UG 250052)', fonte: 'portal' })
assert.equal(gravado['c-fed-sem'].dias, null, 'UG sem dado: sem prazo')
assert.equal(gravado['c-cons'].dias, null, 'consórcio: sem prazo')
assert.equal((await atualizarPagometroContratacoes(pool, { log: () => {} })).alteradas, 0, 'segunda rodada: nada muda')
// O prazo do município muda → só a linha dele é regravada.
await pool.query(`UPDATE pagometro SET dias_saude = 50 WHERE uf = 'SP'`)
assert.equal((await atualizarPagometroContratacoes(pool, { log: () => {} })).alteradas, 1)
await pool.query(`UPDATE pagometro SET dias_saude = 10 WHERE uf = 'SP'`)
await atualizarPagometroContratacoes(pool, { log: () => {} })
await pool.end()

// ── 2) a rota: score do SQL = score do JS, ordem e filtro ────────────────────────────
const { GET } = await import('../src/app/api/opportunities/route')
const { NextRequest } = await import('next/server')
const pedir = async (qs: string) => {
  const r = await GET(new NextRequest(`http://localhost/api/opportunities?${qs}`))
  assert.equal(r.status, 200, `GET ?${qs}`)
  return (await r.json()) as { oportunidades: { id: string; score: number; diasPagamento?: number | null; pagometro?: { dias: number } | null }[]; kpis: { total: number } }
}
// Aberta (85) · 0,85 = 72,25. Capacidade = média CAPAG/prazo quando há prazo:
//   mun: CAPAG A 100, prazo 10 d → 100        → 72,25 + 15    = 87,25 → 87
//   est: CAPAG C 40,  prazo 30 d → 60  → 50   → 72,25 + 7,5   = 79,75 → 80
//   fed: sem CAPAG 60, prazo 60 d → 20 → 40   → 72,25 + 6     = 78,25 → 78
//   fed-sem e cons: sem prazo, CAPAG neutra 60 → 72,25 + 9    = 81,25 → 81
const esperado: Record<string, number> = { 'pncp-c-mun': 87, 'pncp-c-est': 80, 'pncp-c-fed': 78, 'pncp-c-fed-sem': 81, 'pncp-c-cons': 81 }
const todas = await pedir('status=aberto&limit=50')
assert.equal(todas.oportunidades.length, 5)
for (const o of todas.oportunidades) assert.equal(o.score, esperado[o.id], `score JS de ${o.id}`)
// A ordem vem do SQL (score desc): bater com o número do JS prova que as duas fórmulas são a mesma.
const scores = todas.oportunidades.map((o) => o.score)
assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'a ordem do banco segue o score mostrado')
assert.equal(todas.oportunidades[0].id, 'pncp-c-mun')
assert.equal(todas.oportunidades[4].id, 'pncp-c-fed')
// O selo (índice) e o score (coluna) contam o mesmo prazo.
for (const o of todas.oportunidades) assert.equal(o.pagometro?.dias ?? null, o.diasPagamento ?? null, `selo e score de ${o.id}`)

const ate15 = await pedir('status=aberto&pagaAte=15')
assert.deepEqual(ate15.oportunidades.map((o) => o.id), ['pncp-c-mun'])
assert.equal(ate15.kpis.total, 1, 'o total do filtro vem do banco, não da página')
const ate45 = await pedir('status=aberto&pagaAte=45')
assert.deepEqual(ate45.oportunidades.map((o) => o.id).sort(), ['pncp-c-est', 'pncp-c-mun'])
const min81 = await pedir('status=aberto&minScore=81')
assert.deepEqual(min81.oportunidades.map((o) => o.id).sort(), ['pncp-c-cons', 'pncp-c-fed-sem', 'pncp-c-mun'], 'minScore em SQL usa a mesma fórmula')

console.log('OK: gravação, score SQL = JS, ordem e filtro "paga em até" conferidos')
process.exit(0)
