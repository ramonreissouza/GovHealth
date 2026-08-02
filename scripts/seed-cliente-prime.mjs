// scripts/seed-cliente-prime.mjs
// Cria/atualiza a conta de APRESENTAÇÃO da Prime Medical no plano Empresa
// (tudo do Pro + Radar de Chat + equipe). CNPJ real p/ o histórico bater com a
// realidade (resultados homologados do PNCP já casam por ni_fornecedor).
// Idempotente (upsert). Uso: node scripts/seed-cliente-prime.mjs
import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'
import bcrypt from 'bcryptjs'

// Senha de seed via env; sem env, gera aleatória e avisa (nunca hardcode no repo).
function senhaSeed(varName, quem) {
  const v = process.env[varName]
  if (v) return v
  const gen = crypto.randomBytes(9).toString('base64url')
  console.warn(`⚠ ${varName} não definida — senha ALEATÓRIA p/ ${quem}: ${gen}  (defina ${varName} no .env.local p/ senha estável)`)
  return gen
}

const url = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const u = {
  email: 'primemedical@govhealth.ai',
  nome: 'Prime Medical',
  senha: senhaSeed('PRIME_SENHA', 'primemedical@govhealth.ai'),
  empresa: 'Prime Medical Comércio de Material Médico',
  cnpj: '09342946000100',
  plano: 'empresa',
}

const id = u.email.toLowerCase()
const hash = await bcrypt.hash(u.senha, 10)
await c.query(
  `INSERT INTO usuarios (id,email,nome,senha_hash,role,empresa,cnpj,plano,status_assinatura)
   VALUES ($1,$1,$2,$3,'user',$4,$5,$6,'ativa')
   ON CONFLICT (id) DO UPDATE SET
     nome=EXCLUDED.nome, senha_hash=EXCLUDED.senha_hash, empresa=EXCLUDED.empresa,
     cnpj=EXCLUDED.cnpj, plano=EXCLUDED.plano, status_assinatura='ativa',
     suspenso=false, deleted_at=NULL, atualizado_em=now()`,
  [id, u.nome, hash, u.empresa, u.cnpj, u.plano],
)

const chk = await c.query(
  `SELECT id,nome,empresa,cnpj,plano,status_assinatura FROM usuarios WHERE id=$1`, [id])
console.log('OK conta criada/atualizada:')
console.log(JSON.stringify(chk.rows[0], null, 2))
console.log(`\n  LOGIN:  ${u.email}\n  SENHA:  ${u.senha}\n  PLANO:  Empresa (Radar de Chat + equipe)\n`)

await c.end()
