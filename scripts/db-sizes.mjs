// scripts/db-sizes.mjs — diagnóstico de espaço: tamanho por tabela + contagem de linhas.
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

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const dbSize = await client.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`)
  console.log('BANCO TOTAL:', dbSize.rows[0].size, '\n')

  const q = `
    SELECT
      c.relname AS tabela,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
      pg_size_pretty(pg_relation_size(c.oid)) AS dados,
      pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS indices_toast,
      c.reltuples::bigint AS linhas_aprox,
      pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC;
  `
  const r = await client.query(q)
  console.log('TABELA'.padEnd(28), 'TOTAL'.padStart(10), 'DADOS'.padStart(10), 'IDX/TOAST'.padStart(11), 'LINHAS'.padStart(12))
  console.log('-'.repeat(75))
  for (const row of r.rows) {
    console.log(
      String(row.tabela).padEnd(28),
      String(row.total).padStart(10),
      String(row.dados).padStart(10),
      String(row.indices_toast).padStart(11),
      String(row.linhas_aprox).padStart(12),
    )
  }
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
