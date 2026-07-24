// scripts/radar/connect.mjs — captura de sessão ONE-SHOT (debug/manual do operador).
// Uso normal do produto é pela TELA (que enfileira e o connect-service processa).
// Este utilitário conecta UMA credencial direto, útil para diagnóstico.
//
//   node scripts/radar/connect.mjs --cnpj 12345678000190
//   node scripts/radar/connect.mjs --cred <id> --wait 300
//   node scripts/radar/connect.mjs --cnpj ... --simulado   # sessão fake (teste)

import fs from 'node:fs'
import pg from 'pg'
import { capturarSessaoGovbr, encrypt } from './capture.mjs'

function loadEnv() {
  try {
    const e = fs.readFileSync('.env.local', 'utf8')
    for (const k of ['DATABASE_URL', 'RADAR_CRED_KEY']) {
      if (process.env[k]) continue
      const m = e.match(new RegExp(`^${k}=(.*)$`, 'm'))
      if (m) process.env[k] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {}
}
loadEnv()
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def }
const SIMULADO = process.argv.includes('--simulado')
const CRED_ID = arg('cred')
const CNPJ = (arg('cnpj') || '').replace(/\D+/g, '')
const WAIT_S = Number(arg('wait', '300'))

if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }
if (!process.env.RADAR_CRED_KEY) { console.error('ERRO: RADAR_CRED_KEY não configurada (cofre).'); process.exit(1) }
if (!CRED_ID && !CNPJ) { console.error('Informe --cred <id> ou --cnpj <cnpj>.'); process.exit(1) }
const KEY = process.env.RADAR_CRED_KEY

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  const { rows } = CRED_ID
    ? await client.query(`SELECT id, titular_id, conector_id, cnpj, login FROM radar_credenciais WHERE id=$1`, [CRED_ID])
    : await client.query(`SELECT id, titular_id, conector_id, cnpj, login FROM radar_credenciais WHERE cnpj=$1 ORDER BY criado_em DESC`, [CNPJ])
  if (!rows.length) { console.error('Credencial não encontrada. Cadastre a conexão na tela do Radar primeiro.'); process.exit(1) }
  if (rows.length > 1) { console.error(`Mais de uma credencial p/ CNPJ ${CNPJ}. Use --cred <id>. Ids: ${rows.map(r => r.id).join(', ')}`); process.exit(1) }
  const cred = rows[0]

  const r = SIMULADO
    ? { status: 'ok', detalhe: 'sessão simulada', storageState: JSON.stringify({ cookies: [], origins: [] }) }
    : await capturarSessaoGovbr({ waitS: WAIT_S })

  const conexao = r.status === 'ok' ? 'conectado' : 'erro'
  await client.query(
    `UPDATE radar_credenciais SET storage_state = COALESCE($2, storage_state), metodo='sessao',
        conexao_status=$3, conexao_detalhe=$4, ativo=true, atualizado_em=now() WHERE id=$1`,
    [cred.id, r.storageState ? encrypt(KEY, r.storageState) : null, conexao, r.detalhe ?? null])
  await client.query(
    `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, verificado_em, tentado_em, detalhe, atualizado_em)
     VALUES ($1,$2,$3,$4, ${r.status === 'ok' ? 'now()' : 'NULL'}, now(), $5, now())
     ON CONFLICT (credencial_id) DO UPDATE SET status=EXCLUDED.status,
       verificado_em=${r.status === 'ok' ? 'now()' : 'radar_saude.verificado_em'}, tentado_em=now(), detalhe=EXCLUDED.detalhe, atualizado_em=now()`,
    [cred.id, cred.titular_id, cred.conector_id, r.status, r.detalhe ?? null])

  if (r.status === 'ok') console.log(`✓ Sessão capturada e cifrada (CNPJ ${cred.cnpj}). O Radar já pode monitorar (npm run radar:sync).`)
  else { console.error(`✗ ${r.status}: ${r.detalhe ?? ''}`); process.exitCode = 1 }
} catch (e) {
  console.error('Falha na captura:', e?.message ?? e); process.exitCode = 1
} finally { await client.end() }
