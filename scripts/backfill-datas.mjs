// scripts/backfill-datas.mjs — backfill DIRIGIDO das datas de abertura/encerramento
// de proposta nas linhas JÁ existentes de contratacoes. Diferente do etl-backfill
// (que varre do mais ANTIGO p/ o mais novo e é longo), aqui varremos em FATIAS de
// poucos dias, do MAIS RECENTE para o mais antigo — assim as licitações que aparecem
// no topo da tela /estados (ordenada por aberto DESC, data_publicacao DESC) recebem
// datas primeiro. Só UPDATE das 2 colunas; sem itens/resultados; não insere linhas.
//
// Uso:  node scripts/backfill-datas.mjs           (últimos 240 dias, 27 UFs)
//   ETL_DIAS=25  janela · ETL_UF=SP  · ETL_FATIA=4 (dias/fatia) · ETL_DELAY=150
//
// Nota: Dispensa/Inexigibilidade são contratação direta e normalmente NÃO têm janela
// de propostas — para elas as datas ficam nulas (correto; a tela mostra "—").

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const CONSULTA = 'https://pncp.gov.br/api/consulta/v1'
const UFS = (process.env.ETL_UF ?? 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR').split(',').map((s) => s.trim()).filter(Boolean)
const MODS = (process.env.ETL_MODALIDADES ?? '6,8,4,5,9,12').split(',').map((s) => s.trim())
const DIAS = Number(process.env.ETL_DIAS ?? 240)
const FATIA = Number(process.env.ETL_FATIA ?? 4)
const DELAY = Number(process.env.ETL_DELAY ?? 150)
const TAM = 50
const MAXPAG = 400

const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ts = () => new Date().toLocaleString('pt-BR')

// Fatias [di,df] cobrindo os últimos DIAS, do MAIS RECENTE para o mais antigo.
function fatias() {
  const out = []
  const fim = new Date()
  const limite = new Date(fim.getTime() - DIAS * 86400000)
  let df = fim
  while (df > limite) {
    const di = new Date(Math.max(df.getTime() - (FATIA - 1) * 86400000, limite.getTime()))
    out.push([fmt(di), fmt(df)])
    df = new Date(di.getTime() - 86400000)
  }
  return out
}

async function fetchPage(mod, uf, di, df, pagina, tent = 0) {
  const sp = new URLSearchParams({ dataInicial: di, dataFinal: df, codigoModalidadeContratacao: String(mod), uf, pagina: String(pagina), tamanhoPagina: String(TAM) })
  try {
    const res = await fetch(`${CONSULTA}/contratacoes/publicacao?${sp}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    if (res.status === 404) return { data: [], totalPaginas: 0 }
    if ((res.status === 429 || res.status >= 500) && tent < 5) { await sleep(2000 * (tent + 1)); return fetchPage(mod, uf, di, df, pagina, tent + 1) }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) { if (tent < 5) { await sleep(2000 * (tent + 1)); return fetchPage(mod, uf, di, df, pagina, tent + 1) } throw e }
}

// Neon derruba conexões ociosas; cliente recriável + reconexão sob demanda.
let db = null
function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', () => { db = null })
  return c
}
async function dbQuery(text, params, tent = 0) {
  try {
    if (!db) { db = novoDb(); await db.connect() }
    return await db.query(text, params)
  } catch (e) {
    try { await db?.end() } catch {}
    db = null
    if (tent < 5) { await sleep(1000 * (tent + 1)); return dbQuery(text, params, tent + 1) }
    throw e
  }
}
const UPD = `UPDATE contratacoes SET
    data_abertura_proposta = COALESCE($2, data_abertura_proposta),
    data_encerramento_proposta = COALESCE($3, data_encerramento_proposta)
  WHERE numero_controle_pncp = $1`

const SLICES = fatias()
console.log(`[backfill-datas] início ${ts()} — ${DIAS}d em ${SLICES.length} fatias de ${FATIA}d (recente→antigo) · ${UFS.length} UFs · mods=${MODS.join(',')}`)
let totAtualizadas = 0
try {
  for (const [di, df] of SLICES) {
    let sliceUpd = 0
    for (const uf of UFS) {
      for (const mod of MODS) {
        for (let pagina = 1; pagina <= MAXPAG; pagina++) {
          let j
          try { j = await fetchPage(mod, uf, di, df, pagina) }
          catch { continue } // pula a página problemática, não abandona a modalidade
          const arr = j.data ?? []
          if (arr.length === 0) break
          for (const c of arr) {
            const ab = (c.dataAberturaProposta ?? '').slice(0, 10) || null
            const en = (c.dataEncerramentoProposta ?? '').slice(0, 10) || null
            if (!ab && !en) continue
            const r = await dbQuery(UPD, [c.numeroControlePNCP, ab, en])
            if (r.rowCount > 0) { sliceUpd++; totAtualizadas++ }
          }
          if (pagina >= (j.totalPaginas ?? pagina)) break
          await sleep(DELAY)
        }
      }
    }
    console.log(`  ✓ fatia ${di}→${df}: +${sliceUpd} (acum ${totAtualizadas}) — ${ts()}`)
  }
} finally { try { await db?.end() } catch {} }
console.log(`[backfill-datas] concluído ${ts()} — ${totAtualizadas} linhas atualizadas.`)
