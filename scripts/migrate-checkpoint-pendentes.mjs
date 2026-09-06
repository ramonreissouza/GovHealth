// scripts/migrate-checkpoint-pendentes.mjs — a coluna que impede a perda silenciosa
// de página no ETL.
//
// O DEFEITO QUE ISTO CONSERTA. Quando o etl-pncp desistia de uma página de listagem
// (5 tentativas, e a página 1 respondendo — ou seja, não é queda do PNCP, é aquela
// página), ele gravava o checkpoint EM CIMA dela:
//
//     [skip] SC/mod9 pág 9 falhou (1x seguidas) — falha após 5 tentativas
//     ...
//     checkpoint de SC/mod9 = 18
//
// A partir daí a página 9 estava perdida para sempre: toda retomada lê o checkpoint e
// começa da seguinte. Nenhuma re-execução, nenhum mutirão, nenhum refresh a revisita.
//
// E a perda é MUDA. Não vira erro, não vira contagem, não aparece no stdout. Medido em
// 05-06/09/2026: uma página perdida em CADA um dos dois mutirões (SC/mod9 pág 9 = 11
// contratações, MG/mod6 pág 14 = 9). Só apareceram porque alguém leu o stderr e caçou
// o buraco na sequência de páginas à mão. Num mutirão de madrugada, ninguém lê.
//
// POR QUE UMA LISTA, E NÃO SIMPLESMENTE NÃO AVANÇAR O CHECKPOINT. Porque não avançar
// trava: uma página permanentemente quebrada faria toda execução futura parar nela e
// nunca chegar ao resto da janela. Foi por isso que o código original avançava — a
// escolha era entre travar e perder, e perder pareceu menos ruim. Com a lista não é
// preciso escolher: o checkpoint avança (o progresso continua durável) e a página fica
// anotada para ser revisitada no começo da próxima passada por aquela UF/modalidade.
//
// Idempotente. Uso: node scripts/migrate-checkpoint-pendentes.mjs
//                   (ou: npm run checkpoint:migrate)

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue
    const m = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) { process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, ''); break }
  }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  console.log('→ adicionando etl_checkpoint.paginas_puladas…')
  // NOT NULL com default '{}' de propósito: o código de leitura nunca precisa tratar
  // NULL, e o código ANTIGO (que não conhece a coluna) continua gravando o checkpoint
  // normalmente — o UPSERT dele não menciona esta coluna, então ela é preservada.
  await client.query(`
    ALTER TABLE etl_checkpoint
      ADD COLUMN IF NOT EXISTS paginas_puladas int[] NOT NULL DEFAULT '{}'`)

  const { rows } = await client.query(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE cardinality(paginas_puladas) > 0)::int com_pendencia
      FROM etl_checkpoint`)
  console.log(`✓ pronto · ${rows[0].total} checkpoint(s), ${rows[0].com_pendencia} com página pendente`)

  console.log('\nPara ver o que está pendente a qualquer momento:')
  console.log("  SELECT chave, ultima_pagina, paginas_puladas FROM etl_checkpoint")
  console.log("   WHERE cardinality(paginas_puladas) > 0 ORDER BY chave;")
} finally {
  await client.end()
}
