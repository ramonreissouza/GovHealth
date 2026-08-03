// scripts/reclassificar-categorias.mjs — drena o balde 'outros' de categoria_saude.
//
// O PROBLEMA: 61.211 dos 93.595 registros (65%) estavam em 'outros'. Não por
// falta de classificação — o isSaude() já confirmou que são saúde — mas por
// falta de CATEGORIAS. E como a seleção do radar filtra por
// `categoria_saude = ANY(categorias_do_perfil)` (src/lib/radar/selecao.ts),
// tudo que caía em 'outros' era invisível para qualquer cliente que marcasse
// categorias no Setup da Empresa.
//
// POR QUE SÓ MEXE EM 'outros': as 6 categorias antigas continuam primeiro na
// ordem de teste do categoria(), então reclassificar apenas 'outros' dá o mesmo
// resultado que reclassificar tudo — sem o risco de um registro já classificado
// trocar de balde e desaparecer da tela de quem filtra pela categoria antiga.
//
// Uso:
//   node scripts/reclassificar-categorias.mjs --dry    # só mostra o que faria
//   node scripts/reclassificar-categorias.mjs          # grava
//   npm run categorias:reclassificar -- --dry

import fs from 'node:fs'
import pg from 'pg'
import { categoria } from './saude-filter.mjs'

const DRY = process.argv.includes('--dry')
const LOTE = 2000

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const { rows } = await db.query(
  `SELECT numero_controle_pncp ncp, objeto_compra FROM contratacoes
    WHERE categoria_saude = 'outros' AND objeto_compra IS NOT NULL`)

console.log(`[reclassificar] ${rows.length} registros em 'outros'${DRY ? ' — ENSAIO A SECO' : ''}`)

const porCategoria = new Map()
const mudar = []
for (const r of rows) {
  const nova = categoria(r.objeto_compra)
  porCategoria.set(nova, (porCategoria.get(nova) ?? 0) + 1)
  if (nova !== 'outros') mudar.push({ ncp: r.ncp, cat: nova })
}

console.log('\ncomo ficaria a distribuição:')
for (const [cat, n] of [...porCategoria.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = (n / rows.length * 100).toFixed(1)
  console.log(`  ${cat.padEnd(20)} ${String(n).padStart(6)}  ${pct.padStart(5)}%`)
}
const resgatados = rows.length - (porCategoria.get('outros') ?? 0)
console.log(`\n${resgatados} resgatados de 'outros' (${(resgatados / rows.length * 100).toFixed(1)}%), `
  + `${porCategoria.get('outros') ?? 0} continuam sem categoria`)

// Amostra de cada categoria nova — é o que permite conferir a olho se a regra
// pegou o que devia, antes de gravar.
console.log('\namostra por categoria nova:')
for (const cat of [...porCategoria.keys()].filter((c) => c !== 'outros').sort()) {
  const ex = rows.filter((r) => categoria(r.objeto_compra) === cat).slice(0, 2)
  console.log(`\n  ── ${cat} ──`)
  for (const e of ex) console.log(`     ${e.objeto_compra.slice(0, 150).replace(/\s+/g, ' ')}`)
}

if (DRY) {
  console.log('\n[reclassificar] ensaio a seco — nada gravado.')
  await db.end()
  process.exit(0)
}

let gravados = 0
for (let i = 0; i < mudar.length; i += LOTE) {
  const fatia = mudar.slice(i, i + LOTE)
  const vals = fatia.map((_, k) => `($${k * 2 + 1},$${k * 2 + 2})`).join(',')
  const { rowCount } = await db.query(
    `UPDATE contratacoes c SET categoria_saude = v.cat
       FROM (VALUES ${vals}) AS v(ncp, cat)
      WHERE c.numero_controle_pncp = v.ncp`,
    fatia.flatMap((m) => [m.ncp, m.cat]))
  gravados += rowCount
  console.log(`  ${gravados}/${mudar.length} gravados`)
}

const { rows: final } = await db.query(
  `SELECT categoria_saude, count(*) n FROM contratacoes GROUP BY 1 ORDER BY 2 DESC`)
console.log('\n[reclassificar] distribuição final no banco:')
for (const r of final) console.log(`  ${String(r.categoria_saude).padEnd(20)} ${String(r.n).padStart(6)}`)

await db.end()
