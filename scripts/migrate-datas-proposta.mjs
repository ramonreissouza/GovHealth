// scripts/migrate-datas-proposta.mjs — adiciona as datas de abertura e encerramento
// de proposta em contratacoes (o ETL só guardava data_publicacao). Alimenta as 3
// colunas de data (Publicação · Abertura · Fechamento) dos Portais Estaduais.
// Idempotente. Uso: node scripts/migrate-datas-proposta.mjs (ou npm run datas:migrate)

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

const SQL = `
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS data_abertura_proposta DATE;
  ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS data_encerramento_proposta DATE;
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ adicionando data_abertura_proposta / data_encerramento_proposta…')
  await client.query(SQL)
  console.log('✓ Migração de datas de proposta concluída.')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
