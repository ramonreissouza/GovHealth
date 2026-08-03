// scripts/migrate-portais.mjs — colunas para identificar o PORTAL da disputa.
//
// `usuario_nome` guarda o campo `usuarioNome` do PNCP (o sistema que publicou:
// "Compras.gov.br", "PROCERGS…", "ECustomize…"). Medimos que ele vem preenchido em
// praticamente 100% das respostas, enquanto `linkSistemaOrigem` (gravado em
// `link_externo`) só aparece em ~44% — por isso os DOIS são capturados: a URL é a
// melhor evidência, o nome do sistema é a que tem cobertura.
//
// `portal_backfill_em` marca o registro já visitado pelo backfill, para o crawl ser
// RESUMÍVEL: o PNCP limita a ~1 req/s, então a varredura dos 93 mil registros roda
// em vários dias e precisa poder parar e continuar sem repetir trabalho.
//
// Idempotente. Uso: node scripts/migrate-portais.mjs (ou: npm run portais:migrate)

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
  console.log('→ adicionando colunas de portal em contratacoes…')
  await client.query(`ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS usuario_nome TEXT`)
  await client.query(`ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS portal_backfill_em TIMESTAMPTZ`)

  // Índice parcial: a fila do backfill é "quem ainda não foi visitado".
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_contratacoes_portal_pendente
       ON contratacoes (data_publicacao DESC NULLS LAST)
     WHERE portal_backfill_em IS NULL`)

  const { rows: [r] } = await client.query(
    `SELECT count(*) total,
            count(*) FILTER (WHERE portal_backfill_em IS NOT NULL) visitados,
            count(usuario_nome) com_sistema,
            count(link_externo) com_link
       FROM contratacoes`)
  console.log(`✓ pronto — ${r.total} contratações | visitadas: ${r.visitados} | com sistema: ${r.com_sistema} | com link: ${r.com_link}`)
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
