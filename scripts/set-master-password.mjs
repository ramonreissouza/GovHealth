// scripts/set-master-password.mjs — define/rotaciona a senha da conta MASTER.
// Uso:
//   node scripts/set-master-password.mjs                 (gera senha forte e mostra)
//   ADMIN_PASSWORD='SuaSenhaForte!' node scripts/set-master-password.mjs
//   ADMIN_EMAIL=admin@govhealth.ai ... (default admin@govhealth.ai)
import fs from 'node:fs'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

if (!process.env.DATABASE_URL) {
  try { const e = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m); if (e) process.env.DATABASE_URL = e[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const email = (process.env.ADMIN_EMAIL ?? 'admin@govhealth.ai').toLowerCase()
function senhaForte() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''; const b = crypto.randomBytes(18)
  for (let i = 0; i < 18; i++) s += c[b[i] % c.length]
  return s + '!9'
}
const senha = process.env.ADMIN_PASSWORD || senhaForte()

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const hash = bcrypt.hashSync(senha, 10)
  const r = await client.query(`UPDATE usuarios SET senha_hash=$1, atualizado_em=now() WHERE id=$2 AND role='master' RETURNING id`, [hash, email])
  if (!r.rowCount) { console.error(`✖ Nenhum master com id=${email}. Rode o seed antes (npm run admin:seed).`); process.exitCode = 1 }
  else {
    console.log(`✓ Senha do master (${email}) atualizada.`)
    console.log(`  SENHA: ${senha}`)
    console.log('  Guarde com segurança — ela NÃO fica armazenada em claro (só o hash bcrypt).')
  }
} catch (e) { console.error('Falha:', e.message); process.exitCode = 1 }
finally { await client.end() }
