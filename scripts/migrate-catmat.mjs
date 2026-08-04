// scripts/migrate-catmat.mjs — catálogo CATMAT local (nível PDM) + coluna de casamento.
//
// POR QUE PDM E NÃO ITEM. O Painel de Preços do Compras.gov aceita dois tipos de
// código: `codigoItemCatalogo` e `codigoPdm`. Medi os dois:
//   • por item  (catmat 401445): 7 registros de preço
//   • por PDM   (pdm 10436)    : 3.554 registros de preço
// O dado de preço vive no nível PDM. E casar contra 4.435 PDMs é 9x menos alvos
// que contra 40.517 itens de catálogo, com nomes curtos e canônicos
// ("AGULHA HIPODERMICA") em vez de especificações longas.
//
// POR QUE NÃO COLHER DO PNCP. O PNCP tem os campos `catalogo`,
// `categoriaItemCatalogo` e `catalogoCodigoItem` no item — e vêm NULOS. Sondei 12
// contratações de 6 estados: 0 de 306 itens preenchidos (0,0%). Não há o que colher.
// (Já `ncmNbsCodigo` vem em 26,5% — não serve para preço, porque o Painel não
// aceita NCM, mas é o melhor identificador de produto que o PNCP nos dá.)
//
// Uso: npm run catmat:migrate

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

await db.query(`
  CREATE TABLE IF NOT EXISTS catmat_pdm (
    codigo_pdm    INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    -- nome sem acento e em minúsculas: é o campo que o casamento usa, gravado uma
    -- vez na ingestão para não recalcular 4.435 normalizações por rodada.
    nome_norm     TEXT NOT NULL,
    codigo_classe INTEGER,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)

await db.query(`CREATE INDEX IF NOT EXISTS idx_catmat_pdm_classe ON catmat_pdm (codigo_classe)`)
// Índice trigram para similaridade — mesmo motivo do idx_contratacoes_objeto_trgm.
await db.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)
await db.query(`CREATE INDEX IF NOT EXISTS idx_catmat_pdm_nome_trgm ON catmat_pdm USING gin (nome_norm gin_trgm_ops)`)

// O casamento fica no ITEM (696 mil linhas), não na contratação: uma licitação de
// material hospitalar tem itens de PDMs diferentes, e o preço de referência é por item.
await db.query(`ALTER TABLE itens ADD COLUMN IF NOT EXISTS codigo_pdm INTEGER`)
// Como o casamento foi feito, para dar para auditar e re-rodar só o que é fraco:
// 'exato' = nome do PDM contido na descrição · 'trigram' = similaridade.
await db.query(`ALTER TABLE itens ADD COLUMN IF NOT EXISTS pdm_metodo TEXT`)
await db.query(`ALTER TABLE itens ADD COLUMN IF NOT EXISTS pdm_score NUMERIC`)
await db.query(`CREATE INDEX IF NOT EXISTS idx_itens_codigo_pdm ON itens (codigo_pdm) WHERE codigo_pdm IS NOT NULL`)

const { rows: [r] } = await db.query(
  `SELECT (SELECT count(*) FROM catmat_pdm) pdms, (SELECT count(codigo_pdm) FROM itens) itens_casados`)
console.log(`ok — catmat_pdm: ${r.pdms} PDMs · itens casados: ${r.itens_casados}`)
await db.end()
