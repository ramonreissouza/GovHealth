// scripts/set-user-password.mjs — define/rotaciona a senha de uma conta de usuário.
// Uso:
//   USER_EMAIL='fulano@dominio.com' node scripts/set-user-password.mjs          (gera senha forte)
//   USER_EMAIL='fulano@dominio.com' USER_PASSWORD='SenhaForte123!' node scripts/set-user-password.mjs
import fs from 'node:fs'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

if (!process.env.DATABASE_URL) {
  try { const e = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m); if (e) process.env.DATABASE_URL = e[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const email = (process.env.USER_EMAIL ?? '').toLowerCase().trim()
if (!email) { console.error('ERRO: defina USER_EMAIL.'); process.exit(1) }

// Senha forte legível: sem caracteres ambíguos, com letras, números e símbolo.
function senhaForte() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''; const b = crypto.randomBytes(16)
  for (let i = 0; i < 16; i++) s += c[b[i] % c.length]
  return s + '#7'
}
const senha = process.env.USER_PASSWORD || senhaForte()

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const hash = bcrypt.hashSync(senha, 10)
  const r = await client.query(
    `UPDATE usuarios SET senha_hash=$1, atualizado_em=now() WHERE id=$2 AND deleted_at IS NULL RETURNING id, role`,
    [hash, email])
  if (!r.rowCount) { console.error(`✖ Nenhuma conta ativa com id=${email}.`); process.exitCode = 1 }
  else {
    console.log(`✓ Senha de ${email} atualizada (role: ${r.rows[0].role}).`)
    console.log(`  SENHA: ${senha}`)
    console.log('  Guarde com segurança — só o hash bcrypt fica no banco.')
  }
} catch (e) { console.error('Falha:', e.message); process.exitCode = 1 }
finally { await client.end() }
