// scripts/migrate-plano-empresa.mjs
// Migra as contas admin (master) e Siemens (demo) para o novo plano "Empresa"
// (Radar de Chat + equipe). Idempotente. Uso: node scripts/migrate-plano-empresa.mjs
import fs from 'node:fs'
import pg from 'pg'

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = fs.readFileSync('.env.local', 'utf8')
  const m = env.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error('DATABASE_URL não encontrada em .env.local')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

const c = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  // Admin: todo master (independe do e-mail configurado em ADMIN_EMAIL).
  const adm = await c.query(
    `UPDATE usuarios SET plano='empresa', atualizado_em=now()
      WHERE role='master' AND COALESCE(plano,'') <> 'empresa'
      RETURNING id`)
  // Siemens (conta de demonstração Pro → Empresa).
  const sie = await c.query(
    `UPDATE usuarios SET plano='empresa', atualizado_em=now()
      WHERE id='siemens@govhealth.ai' AND COALESCE(plano,'') <> 'empresa'
      RETURNING id`)

  console.log('Admin(master) → empresa:', adm.rows.map((r) => r.id).join(', ') || '(nenhum a alterar)')
  console.log('Siemens        → empresa:', sie.rows.map((r) => r.id).join(', ') || '(nenhum a alterar)')

  const check = await c.query(
    `SELECT id, role, plano FROM usuarios WHERE role='master' OR id='siemens@govhealth.ai' ORDER BY role`)
  console.log('\nEstado atual:')
  for (const r of check.rows) console.log(`  ${r.id} · role=${r.role} · plano=${r.plano}`)
} finally {
  await c.end()
}
