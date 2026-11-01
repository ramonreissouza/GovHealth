// scripts/migrate-aceite-termos.mjs — o aceite dos Termos vira EVIDÊNCIA na assinatura.
//
// O "Ao continuar você concorda com os Termos" de /assinar não gravava nada: depois de
// qualquer alteração em /termos não dava para demonstrar qual versão acompanhou cada
// contratação (revisão da #45). Estas colunas guardam a versão aceita dos dois
// documentos, o instante e o IP de quem aceitou.
//
// As mesmas quatro colunas em `usuarios`: o autocadastro com teste grátis e o aceite de
// convite de equipe criam conta sem passar por /assinar, e o "Li e estou de acordo" deles
// também precisa virar prova (criarUsuario e aceitarConvite em src/lib/users.ts gravam
// as quatro no próprio INSERT da conta). Ali o código NÃO tolera a coluna ausente: sem
// esta migração o cadastro falha fechado, em vez de criar conta sem prova de aceite. O
// deploy roda esta migração antes de subir o código (docs/migrations.md).
//
// `aceite_ip` é dado pessoal: anonimizarUsuario o apaga; versão e instante ficam.
//
// Segue docs/migrations.md: idempotente (ADD COLUMN IF NOT EXISTS), sai com código ≠ 0
// na falha, e é compatível com o código de antes (colunas novas, todas anuláveis: o
// código antigo não as escreve nem as lê).
//
// Uso local: npm run aceite:migrate

import fs from 'node:fs'
import { novoClient } from './lib/pg-ssl.mjs'

if (!process.env.DATABASE_URL) {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const client = novoClient(process.env.DATABASE_URL)
await client.connect()
try {
  await client.query(`
    ALTER TABLE assinaturas
      ADD COLUMN IF NOT EXISTS termos_versao      TEXT,
      ADD COLUMN IF NOT EXISTS privacidade_versao TEXT,
      ADD COLUMN IF NOT EXISTS aceite_em          TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS aceite_ip          TEXT`)
  console.log('✓ assinaturas: colunas de aceite dos Termos prontas')
  await client.query(`
    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS termos_versao      TEXT,
      ADD COLUMN IF NOT EXISTS privacidade_versao TEXT,
      ADD COLUMN IF NOT EXISTS aceite_em          TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS aceite_ip          TEXT`)
  console.log('✓ usuarios: colunas de aceite dos Termos prontas')
} catch (e) {
  console.error('Falha na migração:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
