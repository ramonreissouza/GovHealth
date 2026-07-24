// scripts/ingest-capag.mjs — carga da CAPAG (Tesouro Nacional) na tabela `capag`.
// Estados: CSV (UF;…;Classificação da CAPAG). Municípios: XLSX (aba "Prévia da CAPAG",
// colunas Código Município | Nome_Município | UF | CAPAG | …). Pega sempre o recurso
// mais recente via API CKAN do Tesouro. Idempotente (UPSERT por ente/uf/município).
//
// Uso: npm run capag:ingest   (requer DATABASE_URL; `xlsx` já está nas deps)

import fs from 'node:fs'
import pg from 'pg'
import * as XLSXns from 'xlsx'
const XLSX = XLSXns.default ?? XLSXns

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const CKAN = 'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id='

// Espelha normalizeKey de src/lib/text.ts — a chave DEVE bater com a consulta em runtime.
const normalizeKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const letra = (v) => { const c = String(v ?? '').trim().toUpperCase().charAt(0); return 'ABCD'.includes(c) ? c : null }
const anoDoNome = (nome) => { const m = String(nome ?? '').match(/20\d{2}/); return m ? Number(m[0]) : null }

async function recursoMaisRecente(id, formato) {
  const j = await (await fetch(CKAN + id, { signal: AbortSignal.timeout(30000) })).json()
  const rs = (j.result?.resources || []).filter((x) => (x.format || '').toUpperCase() === formato)
  rs.sort((a, b) => (anoDoNome(b.name) ?? 0) - (anoDoNome(a.name) ?? 0) || new Date(b.last_modified || b.created || 0) - new Date(a.last_modified || a.created || 0))
  return rs[0]
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

// UPSERT em lote (chunks) para não fazer milhares de round-trips.
async function upsertLote(rows) {
  const CHUNK = 400
  let n = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const bloco = rows.slice(i, i + CHUNK)
    const vals = []
    const ph = bloco.map((r, k) => {
      const b = k * 10
      vals.push(r.ente_tipo, r.uf, r.municipio_key, r.municipio_nome, r.codigo_ibge, r.nota, r.ind1, r.ind2, r.ind3, r.ano)
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`
    }).join(',')
    await db.query(
      `INSERT INTO capag (ente_tipo, uf, municipio_key, municipio_nome, codigo_ibge, nota, ind1_nota, ind2_nota, ind3_nota, ano)
       VALUES ${ph}
       ON CONFLICT (ente_tipo, uf, municipio_key) DO UPDATE SET
         municipio_nome = EXCLUDED.municipio_nome, codigo_ibge = EXCLUDED.codigo_ibge, nota = EXCLUDED.nota,
         ind1_nota = EXCLUDED.ind1_nota, ind2_nota = EXCLUDED.ind2_nota, ind3_nota = EXCLUDED.ind3_nota,
         ano = EXCLUDED.ano, atualizado_em = now()`,
      vals,
    )
    n += bloco.length
  }
  return n
}

try {
  // ── ESTADOS (CSV) ──────────────────────────────────────────────────────────
  const rEst = await recursoMaisRecente('capag-estados', 'CSV')
  console.log('→ estados:', rEst?.name)
  const txt = await (await fetch(rEst.url, { signal: AbortSignal.timeout(30000) })).text()
  const linhas = txt.split(/\r?\n/).filter((l) => l.trim())
  const head = linhas[0].split(';').map((h) => h.trim())
  const iUF = head.findIndex((h) => /^uf$/i.test(h))
  const iNota = head.findIndex((h) => /classifica.*capag|capag/i.test(h))
  const anoEst = anoDoNome(rEst.name)
  const estados = []
  for (const l of linhas.slice(1)) {
    const c = l.split(';')
    const uf = (c[iUF] ?? '').trim().toUpperCase()
    const nota = letra(c[iNota])
    if (uf.length === 2 && nota) estados.push({ ente_tipo: 'estado', uf, municipio_key: '', municipio_nome: null, codigo_ibge: null, nota, ind1: null, ind2: null, ind3: null, ano: anoEst })
  }
  const nEst = await upsertLote(estados)
  console.log(`✓ estados: ${nEst} gravados (ano ${anoEst})`)

  // ── MUNICÍPIOS (XLSX) ────────────────────────────────────────────────────────
  const rMun = await recursoMaisRecente('capag-municipios', 'XLSX')
  console.log('→ municípios:', rMun?.name, '(baixando…)')
  const buf = Buffer.from(await (await fetch(rMun.url, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.SheetNames.find((s) => /pr[ée]via.*capag/i.test(s)) || wb.SheetNames[0]
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' })
  // Header = linha que contém 'UF' e 'CAPAG' exatos.
  const hi = grid.findIndex((r) => r.some((c) => /^uf$/i.test(String(c).trim())) && r.some((c) => /^capag$/i.test(String(c).trim())))
  if (hi < 0) throw new Error('cabeçalho de municípios não encontrado')
  const H = grid[hi].map((h) => String(h).trim())
  const col = (re) => H.findIndex((h) => re.test(h))
  const iIbge = col(/c[óo]digo.*munic/i), iNome = col(/nome.*munic/i), iUFm = H.findIndex((h) => /^uf$/i.test(h))
  const iCapag = H.findIndex((h) => /^capag$/i.test(h))
  const iN1 = H.findIndex((h) => /^nota\s*1$/i.test(h)), iN2 = H.findIndex((h) => /^nota\s*2$/i.test(h)), iN3 = H.findIndex((h) => /^nota\s*3$/i.test(h))
  const anoMun = anoDoNome(rMun.name)
  const municipios = []
  for (const r of grid.slice(hi + 1)) {
    const uf = (r[iUFm] ?? '').trim().toUpperCase()
    const nome = (r[iNome] ?? '').trim()
    const nota = letra(r[iCapag])
    if (uf.length !== 2 || !nome || !nota) continue
    municipios.push({
      ente_tipo: 'municipio', uf, municipio_key: normalizeKey(nome), municipio_nome: nome,
      codigo_ibge: (r[iIbge] ?? '').toString().trim() || null, nota,
      ind1: letra(r[iN1]), ind2: letra(r[iN2]), ind3: letra(r[iN3]), ano: anoMun,
    })
  }
  const nMun = await upsertLote(municipios)
  console.log(`✓ municípios: ${nMun} gravados (ano ${anoMun})`)
} catch (e) {
  console.error('Falha no ingest CAPAG:', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
