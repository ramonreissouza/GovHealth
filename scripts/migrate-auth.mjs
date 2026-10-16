// scripts/migrate-auth.mjs — aplica db/schema-auth.sql (revogação de sessão e cooldown
// do código 2FA). Idempotente. Uso: node scripts/migrate-auth.mjs  (ou: npm run auth:migrate)

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { sslParaHost } from './lib/pg-ssl.mjs'

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

const sql = fs.readFileSync(path.join('db', 'schema-auth.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: sslParaHost(process.env.DATABASE_URL) })
await client.connect()
try {
  console.log('→ aplicando schema-auth.sql…')
  await client.query(sql)
  console.log('✓ Migração de auth concluída (senha_alterada_em/otp_enviado_em em usuarios).')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
