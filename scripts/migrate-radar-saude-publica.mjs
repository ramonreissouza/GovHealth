// scripts/migrate-radar-saude-publica.mjs
// Permite registrar SAÚDE de um portal monitorado sem credencial (modo público).
//
// radar_saude nasceu pendurada em `credencial_id` (PK + FK), assumindo que todo
// portal monitorado tem login. O PCP não tem: é lido pela página pública. Com o
// monitoramento público capturando de verdade, a tela ficava se contradizendo —
// "671 mensagens não lidas" logo abaixo de "CONECTORES OK 0 / Nenhum conector
// configurado" — porque a saúde do monitor público não tinha onde ser gravada.
//
// A saúde passa a ser identificada por credencial (quando há login) OU pelo par
// (titular, conector) quando é público. Dois índices únicos PARCIAIS, em vez de uma
// PK só, para não impedir que um mesmo tenant tenha duas credenciais (CNPJs
// diferentes) no mesmo portal.
//
// Uso: npm run radar:migrate-saude

import fs from 'node:fs'
import pg from 'pg'

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

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  console.log('→ soltando a PK de credencial_id…')
  await client.query(`ALTER TABLE radar_saude DROP CONSTRAINT IF EXISTS radar_saude_pkey`)
  await client.query(`ALTER TABLE radar_saude ALTER COLUMN credencial_id DROP NOT NULL`)

  console.log('→ índices únicos parciais (com login / sem login)…')
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS radar_saude_cred_uq
       ON radar_saude (credencial_id) WHERE credencial_id IS NOT NULL`)
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS radar_saude_publico_uq
       ON radar_saude (titular_id, conector_id) WHERE credencial_id IS NULL`)

  const n = await client.query(`SELECT count(*)::int n FROM radar_saude`)
  console.log(`✓ Migração concluída (${n.rows[0].n} linha(s) de saúde preservadas).`)
} catch (e) {
  console.error('FALHA:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
