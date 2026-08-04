// scripts/ingest-catmat.mjs — baixa o catálogo CATMAT (nível PDM) das classes de saúde.
//
// São ~4.435 PDMs em 9 classes. O catálogo é praticamente estático (revisão anual),
// então isto roda uma vez e depois só para atualizar.
//
// Uso: npm run catmat:ingest

import fs from 'node:fs'
import pg from 'pg'

const BASE = 'https://dadosabertos.compras.gov.br'
// 6505 medicamentos · 6510 curativos · 6515 instrumentos/equip. médicos · 6520 dentários
// 6525 raios-x · 6530 mobiliário hospitalar · 6540 oftalmo · 6545 kits médicos
// 6550 diagnóstico in vitro
const CLASSES = [6505, 6510, 6515, 6520, 6525, 6530, 6540, 6545, 6550]
const TAM = 500   // teto do endpoint (mínimo 10)

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Mesma normalização do casamento: sem acento, minúsculo, espaço único. */
export function normalizar(s) {
  return (s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira os diacríticos separados pelo NFD
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function getJson(url, tent = 0) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (r.ok) return await r.json()
    // A API responde 400/429 sob rajada — espaçar recupera.
    if ((r.status === 400 || r.status === 429) && tent < 2) { await sleep(2000 * (tent + 1)); return getJson(url, tent + 1) }
    return null
  } catch {
    if (tent < 2) { await sleep(1500); return getJson(url, tent + 1) }
    return null
  }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

let gravados = 0
for (const classe of CLASSES) {
  let pagina = 1, totalPaginas = 1
  do {
    const j = await getJson(`${BASE}/modulo-material/3_consultarPdmMaterial?pagina=${pagina}&tamanhoPagina=${TAM}&codigoClasse=${classe}`)
    const arr = j?.resultado ?? []
    totalPaginas = j?.totalPaginas ?? 1
    if (!arr.length) break

    // UPSERT em lote: 500 PDMs por ida ao banco em vez de 500 idas.
    const vals = [], params = []
    for (const p of arr) {
      const cod = Number(p.codigoPdm), nome = String(p.nomePdm ?? '').trim()
      if (!cod || !nome) continue
      const i = params.length
      vals.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4})`)
      params.push(cod, nome, normalizar(nome), classe)
    }
    if (vals.length) {
      await db.query(
        `INSERT INTO catmat_pdm (codigo_pdm, nome, nome_norm, codigo_classe)
         VALUES ${vals.join(',')}
         ON CONFLICT (codigo_pdm) DO UPDATE
           SET nome = EXCLUDED.nome, nome_norm = EXCLUDED.nome_norm,
               codigo_classe = EXCLUDED.codigo_classe, atualizado_em = now()`, params)
      gravados += vals.length
    }
    console.log(`  classe ${classe} pág ${pagina}/${totalPaginas} — ${arr.length} PDMs (total ${gravados})`)
    pagina++
    await sleep(700)
  } while (pagina <= totalPaginas)
}

const { rows: [r] } = await db.query(
  `SELECT count(*) n, count(DISTINCT codigo_classe) classes, avg(length(nome))::int nome_medio FROM catmat_pdm`)
console.log(`\nfim — ${r.n} PDMs em ${r.classes} classes (nome médio ${r.nome_medio} caracteres)`)
await db.end()
