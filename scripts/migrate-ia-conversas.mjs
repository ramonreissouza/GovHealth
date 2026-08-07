// scripts/migrate-ia-conversas.mjs — histórico das conversas com a IA.
//
// Os dois copilotos perdiam tudo ao sair da tela: o Copiloto IA reiniciava no
// "Olá! Sou o GovHealth AI" e o Copiloto de Edital exigia colar o edital de novo
// para reler a mesma análise. Aqui as conversas passam a viver na CONTA (como no
// Claude/ChatGPT): lista de conversas anteriores, e dá para voltar em qualquer uma.
//
// Uma tabela serve aos dois porque a diferença é só o `tipo`:
//   copiloto → sequência de mensagens user/assistant
//   edital   → 1 mensagem 'user' (o texto do edital) + 1 'assistant' com a análise
//              estruturada em `dados` (JSONB), que é o que a tela redesenha
//
// Uso: npm run ia:migrate

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  await client.query(`CREATE TABLE IF NOT EXISTS ia_conversas (
    id            UUID PRIMARY KEY,
    user_id       TEXT NOT NULL,
    tipo          TEXT NOT NULL,            -- 'copiloto' | 'edital'
    titulo        TEXT NOT NULL DEFAULT 'Nova conversa',
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  // A lista sempre pede "as minhas, deste copiloto, mais recentes primeiro".
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ia_conv_user
    ON ia_conversas (user_id, tipo, atualizado_em DESC)`)

  await client.query(`CREATE TABLE IF NOT EXISTS ia_mensagens (
    id         BIGSERIAL PRIMARY KEY,
    conversa_id UUID NOT NULL REFERENCES ia_conversas(id) ON DELETE CASCADE,
    papel      TEXT NOT NULL,               -- 'user' | 'assistant'
    conteudo   TEXT NOT NULL DEFAULT '',
    dados      JSONB,                       -- análise estruturada (Copiloto de Edital)
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ia_msg_conversa
    ON ia_mensagens (conversa_id, id)`)

  console.log('✓ Migração concluída (ia_conversas + ia_mensagens).')
} catch (e) {
  console.error('FALHA:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
