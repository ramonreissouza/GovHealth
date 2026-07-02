// scripts/migrate-tipo-fornecimento.mjs
// Materializa a classificação de TIPO DE FORNECIMENTO como coluna GERADA (STORED)
// em contratacoes (de objeto_compra) e resultados (de nome_catmat), + índices.
// Objetivo: trocar o regex full-scan (lento no "cold") por igualdade indexada.
// Coluna gerada é preenchida automaticamente para linhas existentes E novas —
// não exige mudança no ETL. Espelha lib/tipo-sql.ts (manter em sincronia).
// Uso: node scripts/migrate-tipo-fornecimento.mjs

import fs from 'node:fs'
import pg from 'pg'

function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}

// CASE espelhando classificarTipo (score-engine.ts) / tipoFornecimentoCaseSql (tipo-sql.ts).
function tipoCaseSql(col) {
  const c = `coalesce(${col}, '')`
  return `CASE
    WHEN ${c} ~* '(manuten[çc]|reparo|conserto|instala[çc]|reforma|loca[çc][ãa]o|aluguel|presta[çc][ãa]o de servi|servi[çc]os? de|m[ãa]o de obra|limpeza|higieniz|esteriliza[çc]|lavanderia|dedetiz|res[íi]duo|transporte de pacient|remo[çc][ãa]o de pacient|servi[çc]o.*ambul[âa]nc|calibra[çc]|gases medicinais|oxig[êe]nio medicinal)' THEN 'servico'
    WHEN ${c} ~* '([óo]rtese|pr[óo]tese|opme|implante|stent|marca-?passo|osteoss[íi]ntese|haste (femoral|intramedular)|placa (de )?tit[âa]nio|parafuso (ortop|pedicular)|lente intraocular|enxerto [óo]sseo|fio de kirschner)' THEN 'opme'
    WHEN ${c} ~* '(medicament|f[áa]rmaco|farmac[êe]ut|antibi[óo]tic|insumo farmac|princ[íi]pio ativo|vacina|soro fisiol|injet[áa]vel|comprimido|ampola|quimioter[áa]pico)' THEN 'medicamento'
    WHEN ${c} ~* '(tom[óo]grafo|resson[âa]ncia|ultrassom|ultrassonograf|raio-?x|mam[óo]grafo|ventilador|respirador|monitor (multi|card|de )|desfibrilador|eletrocardi[óo]grafo|ox[íi]metro|autoclave|equipamento m[ée]dic|equipamento hospitalar|equipamento odontol|mesa cir[úu]rg|foco cir[úu]rg|maca|cama hospitalar|incubadora|bomba de infus|aparelho de|cadeira odontol)' THEN 'equipamento'
    WHEN ${c} ~* '(acess[óo]rio|insumo|descart[áa]vel|seringa|agulha|luva|gaze|atadura|cateter|sonda|equipo|eletrodo|m[áa]scara|avental|compressa|curativo|fralda|material m[ée]dic|material hospitalar|material de consumo|reagente|kit (para|de) (teste|diagn))' THEN 'acessorio'
    ELSE 'outros'
  END`
}

loadEnv()
if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não configurada (.env.local).')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

async function run(sql) { return client.query(sql) }

try {
  console.log('→ contratacoes.tipo_fornecimento (coluna gerada a partir de objeto_compra)…')
  await run(`ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS tipo_fornecimento TEXT
             GENERATED ALWAYS AS (${tipoCaseSql('objeto_compra')}) STORED`)
  await run(`CREATE INDEX IF NOT EXISTS idx_contr_tipo    ON contratacoes (tipo_fornecimento)`)
  await run(`CREATE INDEX IF NOT EXISTS idx_contr_uf_tipo ON contratacoes (uf, tipo_fornecimento)`)

  console.log('→ resultados.tipo_fornecimento (coluna gerada a partir de nome_catmat)…')
  await run(`ALTER TABLE resultados ADD COLUMN IF NOT EXISTS tipo_fornecimento TEXT
             GENERATED ALWAYS AS (${tipoCaseSql('nome_catmat')}) STORED`)
  await run(`CREATE INDEX IF NOT EXISTS idx_res_tipo ON resultados (tipo_fornecimento)`)

  const c = await run(`SELECT tipo_fornecimento, count(*)::int n FROM contratacoes GROUP BY 1 ORDER BY 2 DESC`)
  const r = await run(`SELECT tipo_fornecimento, count(*)::int n FROM resultados GROUP BY 1 ORDER BY 2 DESC`)
  console.log('✓ contratacoes por tipo:', JSON.stringify(c.rows))
  console.log('✓ resultados por tipo:', JSON.stringify(r.rows))
  console.log('✓ Migração concluída.')
} catch (e) {
  console.error('FALHA:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
