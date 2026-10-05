// Consulta SÓ DE LEITURA ao banco do .env.local. Uso: node q.mjs arquivo.sql
import { createRequire } from 'node:module'
import fs from 'node:fs'
const R = process.env.REPO
const require = createRequire(R + '/package.json')
const pg = require('pg')
const env = fs.readFileSync(R + '/.env.local', 'utf8')
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  await c.query("SET statement_timeout = '300s'")
  await c.query('BEGIN') // só TEMP TABLE; termina em ROLLBACK
  const sqls = fs.readFileSync(process.argv[2], 'utf8').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)
  for (const sql of sqls) {
    const t = Date.now()
    const r = await c.query(sql)
    console.log('\n## ' + sql.split('\n')[0].slice(0, 100) + `  (${Date.now() - t} ms)`)
    console.table(r.rows)
  }
  await c.query('ROLLBACK')
} finally { await c.end() }
