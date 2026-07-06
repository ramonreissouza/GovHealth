// scripts/migrate-equipe.mjs — aplica db/schema-equipe.sql (equipe/assentos, 2FA por
// e-mail, sessão única e user_data). Idempotente. Uso: node scripts/migrate-equipe.mjs
// (ou: npm run equipe:migrate)

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

const sql = fs.readFileSync(path.join('db', 'schema-equipe.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ aplicando schema-equipe.sql…')
  await client.query(sql)
  console.log('✓ Migração de equipe concluída (colunas titular_id/assentos/otp_*/sessao_* + tabelas convites, user_data).')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
