// scripts/db-bloat.mjs — dead tuples (inchaço reclamável via VACUUM) + datas mais antigas.
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
  const r = await client.query(`
    SELECT relname AS tabela, n_live_tup AS vivas, n_dead_tup AS mortas,
           CASE WHEN n_live_tup>0 THEN round(100.0*n_dead_tup/n_live_tup,1) ELSE 0 END AS pct_morto,
           last_vacuum, last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0 OR n_live_tup > 1000
    ORDER BY n_dead_tup DESC;
  `)
  console.log('INCHAÇO (dead tuples reclamáveis por VACUUM):')
  console.log('TABELA'.padEnd(22), 'VIVAS'.padStart(10), 'MORTAS'.padStart(10), '%MORTO'.padStart(8))
  console.log('-'.repeat(56))
  for (const x of r.rows) {
    console.log(String(x.tabela).padEnd(22), String(x.vivas).padStart(10), String(x.mortas).padStart(10), String(x.pct_morto).padStart(8))
  }

  // datas: qual o range temporal das contratações (pra avaliar poda de antigas)
  const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='contratacoes'`)
  const names = cols.rows.map(c => c.column_name)
  const dateCol = ['data_encerramento_proposta','data_publicacao','data_abertura_proposta','created_at'].find(c => names.includes(c))
  if (dateCol) {
    const d = await client.query(`SELECT min(${dateCol}) mn, max(${dateCol}) mx, count(*) FILTER (WHERE ${dateCol} < now() - interval '180 days') AS antigas_180d FROM contratacoes`)
    console.log(`\nCONTRATACOES por ${dateCol}: de ${d.rows[0].mn} até ${d.rows[0].mx}`)
    console.log(`  → ${d.rows[0].antigas_180d} contratações com ${dateCol} > 180 dias atrás`)
  }
  console.log('\nColunas de data em contratacoes:', names.filter(n => n.includes('data') || n.includes('_at')).join(', '))
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
