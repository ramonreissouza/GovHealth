// scripts/ingest-emendas.mjs — carga LOCAL/manual do cache de emendas de saúde
// (tabela emendas_saude) para o Radar de Verba. Sem teto de tempo: varre TODAS as
// páginas do Portal com o filtro de função no servidor (codigoFuncao=10) e faz UPSERT.
//
// Espelha src/lib/emendas-ingest.ts (armazenamento cru; o score fica na leitura).
// Uso:  npm run emendas:ingest            (anos = atual e anterior)
//       ETL_ANOS=2026,2025,2024 npm run emendas:ingest
//
// Requer DATABASE_URL e PORTAL_TRANSPARENCIA_API_KEY no .env.local.

import fs from 'node:fs'
import pg from 'pg'

function loadEnv() {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    for (const key of ['DATABASE_URL', 'PORTAL_TRANSPARENCIA_API_KEY']) {
      if (process.env[key]) continue
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
      if (m) process.env[key] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* sem .env.local */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }
if (!process.env.PORTAL_TRANSPARENCIA_API_KEY) { console.error('ERRO: PORTAL_TRANSPARENCIA_API_KEY não configurada.'); process.exit(1) }

const BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados'
const CODIGO_FUNCAO_SAUDE = '10'
const HEADERS = { 'chave-api-dados': process.env.PORTAL_TRANSPARENCIA_API_KEY, Accept: 'application/json' }
const DELAY = Number(process.env.ETL_DELAY ?? 200)
const MAXPAG = Number(process.env.ETL_MAXPAG ?? 400)

const anoAtual = new Date().getFullYear()
const ANOS = (process.env.ETL_ANOS ?? `${anoAtual},${anoAtual - 1}`)
  .split(',').map((s) => Number(s.trim())).filter(Boolean)

const ts = () => new Date().toLocaleString('pt-BR')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function buscarPagina(ano, pagina) {
  const sp = new URLSearchParams({ pagina: String(pagina), ano: String(ano), codigoFuncao: CODIGO_FUNCAO_SAUDE })
  const res = await fetch(`${BASE}/emendas?${sp}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Portal ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

const SQL = `INSERT INTO emendas_saude (codigo_emenda, numero_emenda, ano, autor, tipo_emenda,
    funcao, subfuncao, localidade_gasto, valor_empenhado, valor_liquidado, valor_pago, coletado_em)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
  ON CONFLICT (codigo_emenda) DO UPDATE SET
    numero_emenda=EXCLUDED.numero_emenda, ano=EXCLUDED.ano, autor=EXCLUDED.autor,
    tipo_emenda=EXCLUDED.tipo_emenda, funcao=EXCLUDED.funcao, subfuncao=EXCLUDED.subfuncao,
    localidade_gasto=EXCLUDED.localidade_gasto, valor_empenhado=EXCLUDED.valor_empenhado,
    valor_liquidado=EXCLUDED.valor_liquidado, valor_pago=EXCLUDED.valor_pago, coletado_em=now()`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
console.log(`[emendas] início ${ts()} — anos=${ANOS.join(',')} · delay=${DELAY}ms · maxpag=${MAXPAG}`)
try {
  for (const ano of ANOS) {
    let total = 0, falhas = 0, pagina = 0
    for (pagina = 1; pagina <= MAXPAG; pagina++) {
      let lote
      try { lote = await buscarPagina(ano, pagina) }
      catch (e) { console.warn(`  ${ano} pág ${pagina}: ${e.message} — repetindo em 2s`); await sleep(2000); pagina--; continue }
      if (lote.length === 0) break
      for (const e of lote) {
        try {
          await client.query(SQL, [
            e.codigoEmenda, e.numeroEmenda ?? null, e.ano ?? ano, e.autor ?? null, e.tipoEmenda ?? null,
            e.funcao ?? null, e.subfuncao ?? null, e.localidadeDoGasto ?? null,
            e.valorEmpenhado ?? null, e.valorLiquidado ?? null, e.valorPago ?? null,
          ])
          total++
        } catch { falhas++ }
      }
      if (pagina % 10 === 0) console.log(`  ${ano}: pág ${pagina} — ${total} gravadas${falhas ? ` (${falhas} falhas)` : ''}`)
      await sleep(DELAY)
    }
    console.log(`[emendas] ✓ ${ano}: ${total} emendas de saúde gravadas em ${pagina - 1} páginas${falhas ? ` (${falhas} falhas)` : ''} — ${ts()}`)
  }
} finally {
  await client.end()
}
console.log(`[emendas] concluído ${ts()}.`)
