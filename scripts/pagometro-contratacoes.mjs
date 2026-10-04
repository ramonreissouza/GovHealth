// scripts/pagometro-contratacoes.mjs — grava o prazo de quem paga em cada contratação
// (ver scripts/lib/pagometro-contratacoes.mjs). As cargas do Pagômetro já chamam isto ao
// terminar; rodar à mão serve para preencher logo depois de aplicar o schema.
//
//   npm run pagometro:contratacoes

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { novoPool } from './lib/pg-ssl.mjs'
import { atualizarPagometroContratacoes } from './lib/pagometro-contratacoes.mjs'

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pool = novoPool(process.env.DATABASE_URL, { max: 2, connectionTimeoutMillis: 20_000 })
try {
  await pool.query(fs.readFileSync(path.join(RAIZ, 'db', 'schema-pagometro.sql'), 'utf8'))
  await atualizarPagometroContratacoes(pool)
} catch (e) {
  console.error('[pagometro] contratações falhou:', e)
  process.exitCode = 1
} finally { await pool.end() }
