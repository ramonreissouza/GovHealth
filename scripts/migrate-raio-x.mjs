// scripts/migrate-raio-x.mjs — índice do Raio-X da disputa em contratacoes(cnpj_orgao,
// categoria_saude), o filtro de /api/raio-x. Sem ele a consulta faz seq scan na
// contratacoes inteira: medido 1,3-1,5 s num órgão típico e 5,5 s no maior (05/10/2026).
//
// CONCURRENTLY, fora de transação, para não travar as escritas do ETL enquanto é montado
// (docs/migrations.md, regra 7). Um CONCURRENTLY interrompido deixa o índice INVALID e o
// IF NOT EXISTS pularia ele: confere e refaz.
//
// Uso: npm run raiox:migrate

import fs from 'node:fs'
import { novoClient } from './lib/pg-ssl.mjs'

if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const INDICE = 'idx_contratacoes_orgao_categoria'
const client = novoClient(process.env.DATABASE_URL)
await client.connect()
const validade = async () => (await client.query(
  `SELECT i.indisvalid AS valido, pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = $1`, [INDICE])).rows[0]
try {
  // O CONCURRENTLY espera as transações abertas na tabela terminarem; essa espera não
  // bloqueia leitura nem escrita de ninguém, então pode passar do lock_timeout do deploy.
  await client.query(`SET lock_timeout = '10min'`)
  await client.query(`SET statement_timeout = '20min'`)
  if ((await validade())?.valido === false) {
    console.log('→ índice INVALID de uma tentativa anterior: removendo para refazer…')
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${INDICE}`)
  }
  console.log('→ índice em contratacoes (cnpj_orgao, categoria_saude) (CONCURRENTLY)…')
  const t0 = Date.now()
  await client.query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDICE} ON contratacoes (cnpj_orgao, categoria_saude)`)
  const r = await validade()
  if (!r?.valido) {
    console.error(`✗ o índice ${INDICE} ficou INVALID. Rode este script de novo (ele remove e refaz).`)
    process.exitCode = 1
  } else console.log(`✓ índice pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s, ocupa ${r.tamanho}`)
} catch (e) {
  console.error('Falha na migração do Raio-X:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
