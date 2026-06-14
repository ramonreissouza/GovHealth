// scripts/db-setup.mjs — aplica db/schema.sql no banco (Neon).
// Uso: node scripts/db-setup.mjs   (lê DATABASE_URL do ambiente ou do .env.local)

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
if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não configurada (defina no .env.local).')
  process.exit(1)
}

const sql = fs.readFileSync(path.join('db', 'schema.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

await client.connect()
try {
  await client.query(sql) // pg aceita múltiplos statements numa query simples
  console.log('✓ Schema aplicado com sucesso.')
} catch (e) {
  console.error('Falha ao aplicar schema:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
