// scripts/seed-demo-contas.mjs
// Cria/atualiza duas contas de DEMONSTRAÇÃO para navegar as diferenças de plano:
//   - essencial@govhealth.ai  (plano Essencial)
//   - siemens@govhealth.ai    (plano Pro, perfil "Siemens" para a tela Minhas Disputas)
// Idempotente (upsert). Uso: node scripts/seed-demo-contas.mjs
import fs from 'fs'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL=(.*)/)[1].trim().replace(/^["']|["']$/g, '')
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

// CNPJ real da Siemens nos resultados (para a conta Pro casar com o dado real).
const sie = await c.query(
  `SELECT ni_fornecedor cnpj, count(*)::int n FROM resultados
    WHERE nome_fornecedor ILIKE '%siemens%' AND ni_fornecedor IS NOT NULL
    GROUP BY 1 ORDER BY n DESC LIMIT 1`)
const siemensCnpj = sie.rows[0]?.cnpj ?? null
console.log('Siemens CNPJ (resultados):', siemensCnpj)

const contas = [
  { email: 'essencial@govhealth.ai', nome: 'Cliente Essencial (demo)', senha: 'Essencial@2026', empresa: 'Distribuidora Demo', cnpj: null, plano: 'essencial' },
  { email: 'siemens@govhealth.ai', nome: 'Comercial Siemens (demo)', senha: 'Siemens@2026', empresa: 'Siemens Healthineers', cnpj: siemensCnpj, plano: 'pro' },
]

for (const u of contas) {
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
  console.log('OK', id, '·', u.plano, u.cnpj ? `· cnpj ${u.cnpj}` : '')
}

await c.end()
console.log('\nContas de demo prontas:\n  essencial@govhealth.ai / Essencial@2026 (Essencial)\n  siemens@govhealth.ai   / Siemens@2026   (Pro)')
