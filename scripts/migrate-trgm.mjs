// scripts/migrate-trgm.mjs — instala pg_trgm e cria o índice GIN que acelera a
// busca por TEXTO da seleção automática do Radar (lib/radar/selecao.ts).
//
// Por que um índice de EXPRESSÃO: a seleção casa a agulha já sem acento contra
// `translate(lower(objeto_compra), ...)`. Um índice sobre a coluna crua não serve —
// o índice tem de ser sobre exatamente a mesma expressão do WHERE.
// `lower` e `translate` são IMMUTABLE, então a expressão é indexável.
//
// Idempotente. Uso: node scripts/migrate-trgm.mjs  (ou: npm run trgm:migrate)

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// Precisa bater LETRA A LETRA com o SEM_ACENTO de src/lib/radar/selecao.ts.
const EXPR = `translate(lower(objeto_compra), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ CREATE EXTENSION pg_trgm…')
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')

  console.log('→ criando índice GIN trigram sobre o objeto sem acento (pode levar ~1 min)…')
  const t0 = Date.now()
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_contratacoes_objeto_trgm
       ON contratacoes USING gin (${EXPR} gin_trgm_ops)`)
  console.log(`✓ índice pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  await client.query('ANALYZE contratacoes')
  const { rows } = await client.query(
    `SELECT pg_size_pretty(pg_relation_size('idx_contratacoes_objeto_trgm')) AS tamanho`)
  console.log(`✓ ANALYZE ok — índice ocupa ${rows[0].tamanho}`)
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
