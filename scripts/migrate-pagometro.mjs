// scripts/migrate-pagometro.mjs — schema do Pagômetro (db/schema-pagometro.sql) e o
// índice do filtro "paga em até N dias" em contratacoes.pagometro_dias.
//
// As cargas do Pagômetro também aplicam o schema ao começar; esta migration existe para o
// deploy da main deixar as colunas e o índice prontos ANTES do app novo subir, em vez de
// esperar a próxima carga.
//
// Índice: CONCURRENTLY, fora de transação, para não travar as escritas do ETL na
// contratacoes enquanto é montado (docs/migrations.md, regra 7). Parcial: só as linhas
// com prazo medido entram, que são as únicas que o filtro devolve.
//
// Uso: npm run pagometro:migrate

import fs from 'node:fs'
import path from 'node:path'
import { novoClient } from './lib/pg-ssl.mjs'

if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const INDICE = 'idx_contratacoes_pagometro_dias'
const client = novoClient(process.env.DATABASE_URL)
await client.connect()
const validade = async () => (await client.query(
  `SELECT i.indisvalid AS valido, pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
     FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = $1`, [INDICE])).rows[0]
try {
  console.log('→ schema do Pagômetro (db/schema-pagometro.sql)…')
  await client.query(fs.readFileSync(path.join('db', 'schema-pagometro.sql'), 'utf8'))

  const temColuna = (await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'contratacoes' AND column_name = 'pagometro_dias'`)).rows.length
  if (!temColuna) {
    console.log('✓ sem a tabela contratacoes: nada a indexar')
  } else {
    // O CONCURRENTLY espera as transações abertas na tabela terminarem; essa espera não
    // bloqueia leitura nem escrita de ninguém, então pode ser mais longa que o
    // lock_timeout curto do deploy (que existe para ALTER TABLE).
    await client.query(`SET lock_timeout = '10min'`)
    await client.query(`SET statement_timeout = '20min'`)
    // Um CONCURRENTLY interrompido deixa o índice INVALID, e o IF NOT EXISTS pularia ele.
    if ((await validade())?.valido === false) {
      console.log('→ índice INVALID de uma tentativa anterior: removendo para refazer…')
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${INDICE}`)
    }
    console.log('→ índice em contratacoes.pagometro_dias (CONCURRENTLY)…')
    const t0 = Date.now()
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDICE} ON contratacoes (pagometro_dias) WHERE pagometro_dias IS NOT NULL`)
    const r = await validade()
    if (!r?.valido) {
      console.error(`✗ o índice ${INDICE} ficou INVALID. Rode este script de novo (ele remove e refaz).`)
      process.exitCode = 1
    } else console.log(`✓ índice pronto em ${((Date.now() - t0) / 1000).toFixed(1)}s, ocupa ${r.tamanho}`)
  }
} catch (e) {
  console.error('Falha na migração do Pagômetro:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
