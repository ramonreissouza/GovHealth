// scripts/radar/run.mjs — orquestrador do Radar (WORKER de captura).
// Roda FORA da Vercel (Task Scheduler), como o ETL PNCP. Para cada credencial ativa:
//   decifra credenciais → roda o conector → normaliza/dedup/classifica → grava
//   mensagens + enfileira notificações + atualiza saúde do conector + audita.
// Idempotente (UNIQUE msg_hash + ON CONFLICT DO NOTHING). Nunca dá falso "ok".
//
// Uso:
//   node scripts/radar/run.mjs                 # captura real (Compras.gov.br)
//   node scripts/radar/run.mjs --simulado      # fixtures, sem browser (grava)
//   node scripts/radar/run.mjs --simulado --dry # fixtures, sem gravar (só imprime)

import fs from 'node:fs'
import crypto from 'node:crypto'
import pg from 'pg'
import { conectorSync } from './registry.mjs'

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    for (const key of ['DATABASE_URL', 'RADAR_CRED_KEY']) {
      if (process.env[key]) continue
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
      if (m) process.env[key] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* sem .env.local */ }
}
loadEnv()

const DRY = process.argv.includes('--dry')
const SIMULADO = process.argv.includes('--simulado')

if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// ── cofre (mesmo algoritmo de src/lib/radar/crypto.ts) ───────────────────────
function decrypt(blob) {
  const raw = process.env.RADAR_CRED_KEY
  if (!raw) throw new Error('RADAR_CRED_KEY não configurada')
  const key = Buffer.from(raw.trim(), 'hex')
  const [iv, tag, ct] = blob.split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

// ── hash (mesmo de src/lib/radar/hash.ts) ────────────────────────────────────
const SEP = '␟'
function msgHash({ conectorId, licitacaoId, autor, texto, horarioOrigem }) {
  const partes = [conectorId, licitacaoId, (autor ?? '').trim(), texto.trim(), (horarioOrigem ?? '').trim()]
  return crypto.createHash('sha256').update(partes.join(SEP)).digest('hex')
}

// ── classificação (espelha src/lib/radar/regras.ts) ──────────────────────────
const PADROES = [
  ['convocacao', /convoca[çc]?[ãa]?o?|convocad|comparec/i],
  ['negociacao', /negocia|contraproposta|reduzir.*valor|melhor.*lance/i],
  ['proposta_ajustada', /proposta ajustada|reajust|nova proposta|proposta readequ/i],
  ['habilitacao', /habilita|inabilita|documenta[çc]?[ãa]?o?|documento.*complement/i],
  ['diligencia', /dilig[êe]nc/i],
  ['recurso', /recurso|contrarraz|impugna/i],
  ['prazo', /prazo|at[ée] (o dia|as|às)|encerr|vencimento|expira/i],
]
const ALTA = new Set(['convocacao', 'prazo', 'recurso', 'diligencia'])
const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function classificar(texto, cnpj, regras) {
  const hay = norm(texto)
  const cats = new Set()
  for (const [tipo, re] of PADROES) if (re.test(hay)) cats.add(tipo)
  const dig = (cnpj ?? '').replace(/\D+/g, '')
  if (dig && (texto ?? '').replace(/\D+/g, '').includes(dig)) cats.add('cnpj')
  for (const r of regras) {
    if (!r.ativo) continue
    if (r.tipo === 'qualquer') { cats.add('qualquer'); continue }
    if (r.padrao && hay.includes(norm(r.padrao))) cats.add(r.tipo === 'keyword' ? 'keyword' : r.tipo)
  }
  return [...cats]
}
const prioridadeDe = (cats) => (cats.some((c) => ALTA.has(c)) ? 'alta' : cats.length ? 'normal' : 'baixa')

// ── main ─────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

let totalMsgs = 0, novasMsgs = 0, conectores = 0
try {
  const { rows: creds } = await client.query(
    `SELECT id, titular_id, user_id, conector_id, cnpj, login, cred_cipher, storage_state
       FROM radar_credenciais WHERE ativo = true`,
  )
  console.log(`→ ${creds.length} credencial(is) ativa(s)${SIMULADO ? ' [SIMULADO]' : ''}${DRY ? ' [DRY]' : ''}`)

  for (const cred of creds) {
    conectores++
    const inicio = Date.now()

    // Processos ativos (não silenciados) do tenant p/ este conector.
    const { rows: processos } = await client.query(
      `SELECT id, licitacao_id, titulo, link_portal FROM radar_processos
        WHERE titular_id = $1 AND conector_id = $2 AND status = 'ativo' AND mutado = false`,
      [cred.titular_id, cred.conector_id],
    )
    const mapa = new Map(processos.map((p) => [p.licitacao_id, p]))

    // Regras do tenant (+ globais) e destinatário dos alertas.
    const { rows: regras } = await client.query(
      `SELECT tipo, padrao, ativo FROM radar_regras WHERE titular_id = $1 OR titular_id IS NULL`,
      [cred.titular_id],
    )
    const { rows: [tit] } = await client.query(`SELECT email FROM usuarios WHERE id = $1`, [cred.titular_id])
    const destinatario = tit?.email ?? cred.titular_id

    // Decifra e roda o conector.
    let resultado
    try {
      // Modelo padrão = sessão capturada (storage_state). `cred_cipher` (senha) é
      // legado/opcional e pode ser NULL — só decifra se existir.
      const credencial = SIMULADO
        ? { login: cred.login }
        : {
            login: cred.login,
            senha: cred.cred_cipher ? decrypt(cred.cred_cipher) : undefined,
            storageState: cred.storage_state ? decrypt(cred.storage_state) : undefined,
          }
      const sync = conectorSync(cred.conector_id)
      if (!sync) {
        resultado = { status: 'falha', detalhe: `conector desconhecido: ${cred.conector_id}`, mensagens: [] }
      } else {
        resultado = await sync({ credencial, processos: processos.map((p) => ({ licitacaoId: p.licitacao_id })), simulado: SIMULADO })
      }
    } catch (e) {
      resultado = { status: 'falha', detalhe: String(e?.message ?? e).slice(0, 180), mensagens: [] }
    }

    console.log(`  · ${cred.conector_id}/${cred.cnpj}: status=${resultado.status} msgs=${resultado.mensagens.length} (${resultado.detalhe ?? ''})`)

    // Grava mensagens novas + enfileira notificações.
    for (const m of resultado.mensagens) {
      const proc = mapa.get(m.licitacaoId)
      if (!proc) continue // mensagem de processo não monitorado — ignora
      const cats = classificar(m.texto, cred.cnpj, regras)
      const prioridade = prioridadeDe(cats)
      const hash = msgHash({ conectorId: cred.conector_id, licitacaoId: m.licitacaoId, autor: m.autor, texto: m.texto, horarioOrigem: m.horarioOrigem })
      totalMsgs++

      if (DRY) { console.log(`    [dry] ${prioridade} [${cats.join(',') || '—'}] ${m.texto.slice(0, 70)}`); continue }

      const { rows: ins } = await client.query(
        `INSERT INTO radar_mensagens
           (msg_hash, titular_id, processo_id, conector_id, cnpj, licitacao_id, autor, texto, anexos, horario_origem, raw, categorias, prioridade)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13)
         ON CONFLICT (msg_hash) DO NOTHING
         RETURNING id`,
        [hash, cred.titular_id, proc.id, cred.conector_id, cred.cnpj, m.licitacaoId, m.autor, m.texto,
         JSON.stringify(m.anexos ?? []), m.horarioOrigem, JSON.stringify(m.raw ?? {}), cats, prioridade],
      )
      if (!ins.length) continue // já existia (dedup)
      novasMsgs++
      const msgId = ins[0].id
      const assunto = proc.titulo || m.licitacaoId
      // e-mail + in-app (a leitura confirma ambas).
      await client.query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link)
         VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'email',$6,$7) ON CONFLICT (id) DO NOTHING`,
        [`nm:${msgId}:email`, cred.titular_id, msgId, proc.id, destinatario, assunto, proc.link_portal],
      )
      await client.query(
        `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link, status)
         VALUES ($1,$2,'nova_mensagem',$3,$4,$5,'in_app',$6,$7,'entregue') ON CONFLICT (id) DO NOTHING`,
        [`nm:${msgId}:app`, cred.titular_id, msgId, proc.id, destinatario, assunto, proc.link_portal],
      )
      await client.query(
        `INSERT INTO radar_auditoria (titular_id, acao, entidade, entidade_id, detalhe)
         VALUES ($1,'captura','radar_mensagens',$2,$3::jsonb)`,
        [cred.titular_id, String(msgId), JSON.stringify({ categorias: cats, prioridade })],
      )
    }

    // Saúde do conector (requisito 4.2): verificado_em só avança em 'ok'.
    if (!DRY) {
      const okAgora = resultado.status === 'ok'
      // Persiste sessão renovada (cifrada) quando o conector devolveu storageState.
      if (okAgora && resultado.storageState && !SIMULADO) {
        try {
          const raw = process.env.RADAR_CRED_KEY
          const key = Buffer.from(raw.trim(), 'hex')
          const iv = crypto.randomBytes(12)
          const c = crypto.createCipheriv('aes-256-gcm', key, iv)
          const ctb = Buffer.concat([c.update(resultado.storageState, 'utf8'), c.final()])
          const blob = `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ctb.toString('base64')}`
          await client.query(`UPDATE radar_credenciais SET storage_state = $2, atualizado_em = now() WHERE id = $1`, [cred.id, blob])
        } catch (e) { console.warn('    (não foi possível salvar a sessão):', e.message) }
      }
      await client.query(
        `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status, verificado_em, tentado_em, detalhe, duracao_ms, atualizado_em)
         VALUES ($1,$2,$3,$4, ${okAgora ? 'now()' : 'NULL'}, now(), $5, $6, now())
         ON CONFLICT (credencial_id) DO UPDATE SET
           status = EXCLUDED.status,
           verificado_em = ${okAgora ? 'now()' : 'radar_saude.verificado_em'},
           tentado_em = now(), detalhe = EXCLUDED.detalhe, duracao_ms = EXCLUDED.duracao_ms, atualizado_em = now()`,
        [cred.id, cred.titular_id, cred.conector_id, resultado.status, resultado.detalhe ?? null, Date.now() - inicio],
      )
    }
  }

  console.log(`✓ Radar sync: ${conectores} conector(es), ${totalMsgs} mensagem(ns) vistas, ${novasMsgs} nova(s)${DRY ? ' (dry-run, nada gravado)' : ''}.`)
} catch (e) {
  console.error('Falha no Radar sync:', e)
  process.exitCode = 1
} finally {
  await client.end()
}
