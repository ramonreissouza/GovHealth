// scripts/migrate-reset.mjs — aplica db/schema-reset.sql (colunas de reset de senha).
// Idempotente. Uso: node scripts/migrate-reset.mjs  (ou: npm run reset:migrate)

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const sql = fs.readFileSync(path.join('db', 'schema-reset.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ aplicando schema-reset.sql…')
  await client.query(sql)
  console.log('✓ Migração de reset de senha concluída (reset_hash/reset_expira em usuarios).')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
