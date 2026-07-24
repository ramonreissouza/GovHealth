// scripts/migrate-capag.mjs — aplica db/schema-capag.sql (tabela capag). Idempotente.
// Uso: node scripts/migrate-capag.mjs (ou npm run capag:migrate)

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const sql = fs.readFileSync(path.join('db', 'schema-capag.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ aplicando schema-capag.sql…')
  await client.query(sql)
  console.log('✓ Migração CAPAG concluída (tabela capag).')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
