// scripts/migrate-categoria-mercado.mjs
// Materializa a CATEGORIA DE MERCADO (equip_medico, medicamento, opme…) como coluna
// GERADA (STORED) em resultados, a partir de nome_catmat, + índices.
//
// Por que: a categoria era calculada em tempo de consulta por um CASE de ~16 regexes
// por linha, sem índice possível, sobre 288 mil resultados. Medido em produção:
//   ranking por item filtrando só por UF ............  0,4 s
//   o mesmo ranking + o filtro de categoria ......... 23,6 s
//   o CASE sobre a tabela inteira .................. 145,4 s
// A tela de Breakdown dispara 6 dessas consultas de uma vez num pool de 5 conexões —
// resultado: nunca terminava de carregar. Concorrentes/UF levava 42 s pelo mesmo motivo.
//
// A regra vem de src/lib/categoria-mercado.ts — NÃO é duplicada aqui. Isso importa:
// a coluna gerada CONGELA a expressão no momento em que é criada, então mudar as
// regras no TS não muda o banco sozinho. Por isso a migração guarda a impressão
// digital da expressão num COMMENT e, quando ela muda, derruba e recria a coluna.
// Ou seja: mexeu nas regras → rode isto de novo.
//
// Uso: npm run categoria:migrate
//      node --experimental-strip-types scripts/migrate-categoria-mercado.mjs

import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'
import { categoriaCaseSql } from '../src/lib/categoria-mercado.ts'

if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não configurada (.env.local).')
  process.exit(1)
}

const EXPR = categoriaCaseSql('nome_catmat')
const FINGERPRINT = `categoria-mercado:${crypto.createHash('sha1').update(EXPR).digest('hex').slice(0, 12)}`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
// A recriação da coluna reescreve 288 mil linhas; o padrão de 30 s não dá conta.
await client.query("SET statement_timeout = '900s'")

try {
  const atual = (await client.query(
    `SELECT col_description('resultados'::regclass, a.attnum) AS marca
       FROM pg_attribute a
      WHERE a.attrelid = 'resultados'::regclass AND a.attname = 'categoria_mercado' AND NOT a.attisdropped`,
  )).rows[0]

  if (atual && atual.marca === FINGERPRINT) {
    console.log(`✓ Coluna já existe e está na versão atual das regras (${FINGERPRINT}). Nada a fazer.`)
  } else {
    if (atual) {
      console.log(`→ regras mudaram (coluna estava em "${atual.marca ?? 'sem marca'}") — recriando…`)
      await client.query(`ALTER TABLE resultados DROP COLUMN categoria_mercado`)
    }
    console.log('→ criando resultados.categoria_mercado (coluna gerada a partir de nome_catmat)…')
    const t0 = Date.now()
    await client.query(`ALTER TABLE resultados ADD COLUMN categoria_mercado TEXT GENERATED ALWAYS AS (${EXPR}) STORED`)
    await client.query(`COMMENT ON COLUMN resultados.categoria_mercado IS '${FINGERPRINT}'`)
    console.log(`  coluna preenchida em ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }

  // (categoria, uf) cobre o caso dominante das telas: recorte do Setup da Empresa,
  // que é sempre categoria + estados. O índice só de categoria serve o resto.
  console.log('→ índices…')
  await client.query(`CREATE INDEX IF NOT EXISTS idx_res_categoria    ON resultados (categoria_mercado)`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_res_categoria_uf ON resultados (categoria_mercado, uf)`)
  await client.query(`ANALYZE resultados`)

  const dist = await client.query(
    `SELECT categoria_mercado, count(*)::int n FROM resultados GROUP BY 1 ORDER BY 2 DESC`)
  console.log('✓ distribuição:', dist.rows.map((r) => `${r.categoria_mercado}=${r.n}`).join(' · '))
  console.log('✓ Migração concluída.')
} catch (e) {
  console.error('FALHA:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
