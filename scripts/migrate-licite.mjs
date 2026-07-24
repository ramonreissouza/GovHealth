// scripts/migrate-licite.mjs — habilita fontes de licitação ALÉM do PNCP em
// `contratacoes`, sem quebrar nada do que já existe.
//   - fonte         : 'pncp' (default) | 'licitacoes-e' | ...  → de onde veio a licitação
//   - link_externo  : URL canônica na plataforma de origem (o PNCP monta link próprio;
//                     o Licitações-e precisa guardar o link do detalhe).
// Idempotente. Uso: node scripts/migrate-licite.mjs  (ou npm run licite:migrate)

import fs from 'node:fs'
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
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada (.env.local).'); process.exit(1) }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(`ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'pncp'`)
  await client.query(`ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS link_externo TEXT`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_contr_fonte ON contratacoes (fonte)`)
  const r = await client.query(`SELECT fonte, count(*)::int n FROM contratacoes GROUP BY 1 ORDER BY 2 DESC`)
  console.log('✓ contratacoes.fonte / link_externo prontos. Distribuição por fonte:', JSON.stringify(r.rows))
} catch (e) {
  console.error('FALHA:', e.message); process.exitCode = 1
} finally {
  await client.end()
}
