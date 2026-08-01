// scripts/etl-status.mjs — PROGRESSÃO POR ESTADO da catalogação (read-only).
// Mostra, por UF: contratações, itens, resultados, última página/atualização do
// checkpoint. Ordena por volume. Uso: node scripts/etl-status.mjs
import fs from 'node:fs'
import pg from 'pg'
if (!process.env.DATABASE_URL) {
  const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const contr = await c.query(`SELECT uf, count(*)::int n FROM contratacoes GROUP BY uf`)
const res = await c.query(`SELECT uf, count(*)::int n FROM resultados GROUP BY uf`)
// atividade recente do checkpoint por UF (chaves "uf:XX:mod:..") — máx atualização e páginas somadas
const cp = await c.query(`
  SELECT split_part(chave,':',2) uf,
         max(atualizado_em) ult,
         sum(ultima_pagina)::int pgs
    FROM etl_checkpoint WHERE chave LIKE 'uf:%' GROUP BY 1`)

const mapRes = Object.fromEntries(res.rows.map((r) => [r.uf, r.n]))
const mapCp = Object.fromEntries(cp.rows.map((r) => [r.uf, r]))
const agora = Date.now()
const rows = contr.rows.map((r) => {
  const k = mapCp[r.uf] || {}
  const ageMin = k.ult ? Math.round((agora - new Date(k.ult).getTime()) / 60000) : null
  return { uf: r.uf, contr: r.n, res: mapRes[r.uf] ?? 0, pgs: k.pgs ?? 0, ageMin }
}).sort((a, b) => b.contr - a.contr)

const fmtAge = (m) => m == null ? '—' : m < 60 ? `${m}min` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
let totC = 0, totR = 0
console.log(`\nPROGRESSÃO POR ESTADO — ${new Date().toLocaleString('pt-BR')}`)
console.log('UF   contratações    resultados   págs   últ.atividade')
console.log('──────────────────────────────────────────────────────')
for (const r of rows) {
  totC += r.contr; totR += r.res
  const ativo = r.ageMin != null && r.ageMin < 10 ? ' ⟵ ativo' : ''
  console.log(`${r.uf.padEnd(4)} ${String(r.contr).padStart(9)}   ${String(r.res).padStart(11)}   ${String(r.pgs).padStart(5)}   ${fmtAge(r.ageMin).padStart(6)}${ativo}`)
}
console.log('──────────────────────────────────────────────────────')
console.log(`TOTAL ${String(totC).padStart(8)}   ${String(totR).padStart(11)}   (${rows.length} UFs)`)
await c.end()
