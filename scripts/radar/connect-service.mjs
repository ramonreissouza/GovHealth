// scripts/radar/connect-service.mjs — SERVIÇO DE CONEXÃO (daemon do operador).
// Fica rodando e observa a fila: quando a TELA do Radar enfileira uma conexão
// (radar_credenciais.conexao_status='pendente'), este serviço abre a janela real
// do gov.br, o usuário loga, e a sessão capturada é gravada cifrada. A tela do
// cliente só clica um botão e vê "Conectado ✓" — nunca digita comando.
//
// Uso (operador roda 1x, em background):  npm run radar:connect-service
//   --simulado  → não abre browser; conecta com sessão fake (teste local/UX)
//   --wait <s>  → tempo máximo para o login (padrão 300s)
//   --poll <s>  → intervalo de checagem da fila (padrão 2s)

import fs from 'node:fs'
import pg from 'pg'
import { capturarSessaoPortal, encrypt } from './capture.mjs'
import { portalMeta } from './portais.mjs'

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
const WAIT_S = Number(arg('wait', '300'))
const POLL_S = Number(arg('poll', '2'))

if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }
if (!process.env.RADAR_CRED_KEY) { console.error('ERRO: RADAR_CRED_KEY não configurada (cofre).'); process.exit(1) }
const KEY = process.env.RADAR_CRED_KEY

// POOL, nao Client: o PgBouncer da VM derruba conexao ociosa, e um `pg.Client` sem
// handler de 'error' transforma esse ECONNRESET em excecao NAO TRATADA que mata o
// daemon (aconteceu em 20/08 — ver connect.log). O daemon precisa sobreviver ao
// tempo do login humano, que e justamente quando ele fica ocioso. O pool troca a
// conexao morta por outra sozinho; o handler abaixo garante que o evento nao suba.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 10_000,
})
pool.on('error', (e) => console.error('aviso: conexao do pool caiu e foi descartada:', e?.message ?? e))

/**
 * Mascara o identificador no log. O CPF é PII e não precisa estar inteiro aqui: o log
 * só tem de dizer QUAL conexão foi pedida, e o CNPJ (dado público, publicado em toda
 * licitação) já resolve isso. Primeiros 3 e últimos 2 dígitos bastam para conferir que
 * é a pessoa certa sem guardar o documento em texto claro em disco.
 */
function mascararLogin(login) {
  const s = String(login ?? '').trim()
  const d = s.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(-2)}`
  if (s.includes('@')) return `${s.slice(0, 3)}***@${s.split('@')[1] ?? ''}`
  return s.length <= 3 ? '***' : `${s.slice(0, 3)}***`
}

async function concluir(cred, status, detalhe, storageState) {
  const conexao = status === 'ok' ? 'conectado' : 'erro'
  await pool.query(
    `UPDATE radar_credenciais SET storage_state = COALESCE($2, storage_state), metodo='sessao',
        conexao_status=$3, conexao_detalhe=$4, ativo=true, atualizado_em=now() WHERE id=$1`,
    [cred.id, storageState ? encrypt(KEY, storageState) : null, conexao, detalhe ?? null],
  )
  await pool.query(
    `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, verificado_em, tentado_em, detalhe, atualizado_em)
     VALUES ($1,$2,$3,$4, ${status === 'ok' ? 'now()' : 'NULL'}, now(), $5, now())
     -- WHERE obrigatório: radar_saude_cred_uq é índice único PARCIAL; sem repetir o
     -- predicado o Postgres não o infere e devolve 42P10.
     ON CONFLICT (credencial_id) WHERE credencial_id IS NOT NULL DO UPDATE SET status=EXCLUDED.status,
       verificado_em=${status === 'ok' ? 'now()' : 'radar_saude.verificado_em'}, tentado_em=now(),
       detalhe=EXCLUDED.detalhe, atualizado_em=now()`,
    [cred.id, cred.titular_id, cred.conector_id, status, detalhe ?? null],
  )
  await pool.query(`INSERT INTO radar_auditoria (titular_id, acao, entidade, entidade_id, detalhe)
    VALUES ($1,'cred_conectada','radar_credenciais',$2,$3::jsonb)`, [cred.titular_id, cred.id, JSON.stringify({ status })])
}

async function processarUm() {
  // Reivindica atomicamente 1 pedido pendente (marca 'conectando' antes de abrir).
  const { rows } = await pool.query(
    `UPDATE radar_credenciais SET conexao_status='conectando', atualizado_em=now()
      WHERE id = (SELECT id FROM radar_credenciais WHERE conexao_status='pendente' ORDER BY conexao_pedido_em LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, titular_id, conector_id, cnpj, login`)
  if (!rows.length) return false
  const cred = rows[0]
  console.log(`→ conexão solicitada: CNPJ ${cred.cnpj} (${mascararLogin(cred.login)})`)

  if (SIMULADO) {
    await concluir(cred, 'ok', 'sessão simulada capturada', JSON.stringify({ cookies: [], origins: [] }))
    console.log(`  ✓ [simulado] conectado (CNPJ ${cred.cnpj})`)
    return true
  }
  const meta = portalMeta(cred.conector_id)
  console.log(`  Abrindo o ${meta.nome}… o fornecedor deve concluir o login na janela.`)
  const r = await capturarSessaoPortal(cred.conector_id, { waitS: WAIT_S })
  await concluir(cred, r.status, r.detalhe, r.storageState)
  console.log(`  ${r.status === 'ok' ? '✓ conectado' : '✗ ' + r.status}: ${r.detalhe ?? ''}`)
  return true
}

console.log(`Serviço de conexão do Radar ativo${SIMULADO ? ' [SIMULADO]' : ''}. Observando a fila (Ctrl+C para sair).`)
let parar = false
process.on('SIGINT', () => { parar = true })
while (!parar) {
  try { const fez = await processarUm(); if (!fez) await new Promise((r) => setTimeout(r, POLL_S * 1000)) }
  catch (e) { console.error('erro no loop:', e?.message ?? e); await new Promise((r) => setTimeout(r, POLL_S * 1000)) }
}
await pool.end()
console.log('serviço encerrado.')
