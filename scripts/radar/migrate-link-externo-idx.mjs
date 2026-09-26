// scripts/radar/migrate-link-externo-idx.mjs — índice em contratacoes.link_externo.
//
// O "Adicionar pregão fora do perfil" (POST /api/radar/processos { link }) procura o
// pregão pelo link colado. Sem índice, o link que não está na base varre as ~378 mil
// linhas em ~0,65 s (medido em 25/09/2026), e dezenas em paralelo prendem o pool do
// banco de todos os tenants (revisão da #41). Com o índice, a busca é instantânea.
//
// CONCURRENTLY: não trava as escritas do ETL enquanto o índice é montado. Idempotente.
// Uso: npm run radar:link-idx:migrate

import fs from 'node:fs'
import pg from 'pg'
import { sslParaHost } from '../lib/pg-ssl.mjs'

if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: sslParaHost(process.env.DATABASE_URL) })
await client.connect()
try {
  console.log('→ criando índice em contratacoes.link_externo (CONCURRENTLY, pode levar ~1 min)…')
  const t0 = Date.now()
  await client.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contratacoes_link_externo ON contratacoes (link_externo)')
  console.log(`✓ índice pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  // Um CONCURRENTLY interrompido deixa o índice INVALID, e o IF NOT EXISTS pula ele.
  const { rows: [r] } = await client.query(
    `SELECT i.indisvalid AS valido, pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
       FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = 'idx_contratacoes_link_externo'`)
  if (!r?.valido) {
    console.error('✗ o índice existe mas está INVALID. Rode: DROP INDEX CONCURRENTLY idx_contratacoes_link_externo; e este script de novo.')
    process.exitCode = 1
  } else console.log(`✓ válido, ocupa ${r.tamanho}`)
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
