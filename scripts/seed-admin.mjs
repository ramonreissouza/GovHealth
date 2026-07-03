// scripts/seed-admin.mjs — aplica db/schema-admin.sql e semeia os usuários.
// Migra as contas ANTES hardcoded (demo/teste/pedro) para a tabela usuarios com
// senha em bcrypt, e cria a conta MASTER (ADMIN_EMAIL/ADMIN_PASSWORD).
// Idempotente: ON CONFLICT DO NOTHING (não sobrescreve contas já existentes).
//
// Uso:  node scripts/seed-admin.mjs
//   Master via env: ADMIN_EMAIL=... ADMIN_PASSWORD=...  (default abaixo p/ dev)

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import bcrypt from 'bcryptjs'

function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'admin@govhealth.ai').toLowerCase()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin@GovHealth2026'

// Contas migradas do auth hardcoded (mantêm as senhas conhecidas).
const SEED = [
  { email: ADMIN_EMAIL, nome: 'Administrador', senha: ADMIN_PASSWORD, role: 'master', plano: 'Enterprise', status: 'ativa' },
  { email: 'demo@govhealth.ai', nome: 'Demo User', senha: 'demo123', role: 'user', plano: 'trial', status: 'trial' },
  { email: 'teste@govhealth.ai', nome: 'Usuário de Teste', senha: 'Teste@2026', role: 'user', plano: 'Starter', status: 'ativa' },
  { email: 'pedro.moreira@techealth.com.br', nome: 'Pedro Moreira', senha: 'pedrotec123', role: 'user', plano: 'Growth', status: 'ativa', empresa: 'TecHealth' },
]

const sql = fs.readFileSync(path.join('db', 'schema-admin.sql'), 'utf8')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ aplicando schema-admin.sql…')
  await client.query(sql)

  console.log('→ semeando usuários…')
  for (const u of SEED) {
    const id = u.email.toLowerCase()
    const hash = bcrypt.hashSync(u.senha, 10)
    const r = await client.query(
      `INSERT INTO usuarios (id, email, nome, senha_hash, role, empresa, plano, status_assinatura)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [id, id, u.nome, hash, u.role, u.empresa ?? null, u.plano, u.status],
    )
    console.log(`   ${r.rowCount ? '✓ criado' : '· já existia'}: ${id} (${u.role})`)
  }

  const total = await client.query('SELECT count(*)::int c, count(*) FILTER (WHERE role=\'master\') m FROM usuarios')
  console.log(`✓ Seed concluído. usuarios=${total.rows[0].c} (master=${total.rows[0].m}).`)
  console.log(`  Master: ${ADMIN_EMAIL}${process.env.ADMIN_PASSWORD ? '' : `  (senha default de dev: ${ADMIN_PASSWORD} — troque via ADMIN_PASSWORD)`}`)
} catch (e) {
  console.error('Falha no seed:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
