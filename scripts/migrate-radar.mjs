// scripts/migrate-radar.mjs — aplica db/schema-radar.sql (módulo Radar: conectores,
// credenciais cifradas, processos monitorados, mensagens, regras, notificações,
// saúde do conector e auditoria). Idempotente. Uso: node scripts/migrate-radar.mjs
// (ou: npm run radar:migrate)

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

const sql = fs.readFileSync(path.join('db', 'schema-radar.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ aplicando schema-radar.sql…')
  await client.query(sql)
  console.log('✓ Migração do Radar concluída (radar_conectores/credenciais/processos/mensagens/regras/notificacoes/saude/auditoria).')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
