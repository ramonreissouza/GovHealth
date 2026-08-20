// scripts/vigia-fila.mjs — vigia a fila do coletor SEM tocar no PNCP.
//
// Existe porque a pergunta "o PNCP voltou?" não deve ser respondida perguntando ao
// PNCP: quando ele está nos recusando, cada sondagem extra aprofunda o bloqueio (em
// 20/08/2026 seis requisições seguidas voltaram HTTP 000 em 25s cada). O banco já
// sabe a resposta: se `portal_backfill_em` avançou, é porque o harvest conseguiu
// falar com o PNCP. Zero requisição externa.
//
// Alarma em três casos, cada um com código de saída próprio:
//   0  a fila ANDOU (o coletor voltou a trabalhar)
//   3  o coletor MORREU (o PID de .pipeline-pid não existe mais)
//   4  o prazo acabou sem novidade (re-armar se ainda interessar)
//
// Uso:
//   node scripts/vigia-fila.mjs                 # 12h de vigília, olhada a cada 3min
//   node scripts/vigia-fila.mjs --horas=4 --intervalo=60

import fs from 'node:fs'
import pg from 'pg'

const arg = (nome, padrao) => {
  const m = process.argv.find((a) => a.startsWith(`--${nome}=`))
  return m ? Number(m.split('=')[1]) : padrao
}
const HORAS = arg('horas', 12)
const INTERVALO_S = arg('intervalo', 180)

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hora = () => new Date().toTimeString().slice(0, 8)
const log = (m) => console.log(`[vigia] ${hora()} ${m}`)

/** Conexão nova a cada olhada: o PgBouncer da VM derruba conexão ociosa, e uma
 *  exceção aqui mataria justamente a vigília que deveria durar horas. */
async function medir() {
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  try {
    await db.connect()
    const { rows: [r] } = await db.query(`
      SELECT count(*) FILTER (WHERE portal_backfill_em IS NULL)::int AS pendentes,
             max(portal_backfill_em) AS ultima_marca,
             count(*)::int AS total
        FROM contratacoes`)
    return r
  } finally {
    await db.end().catch(() => {})
  }
}

/** O coletor ainda está de pé? .pipeline-pid é escrito por quem sobe o pipeline. */
function coletorVivo() {
  let pid
  try {
    pid = Number(fs.readFileSync('.pipeline-pid', 'utf8').replace(/^﻿/, '').trim())
  } catch {
    return null // sem arquivo: não é assunto do vigia opinar
  }
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0) // sinal 0 não mata: só pergunta se existe
    return true
  } catch (e) {
    return e.code === 'EPERM' // existe, mas de outro dono
  }
}

const base = await medir()
const fim = Date.now() + HORAS * 3600_000
log(`de olho: ${base.pendentes} pendentes, última marca ${base.ultima_marca?.toISOString() ?? 'nenhuma'}`)
log(`olhada a cada ${INTERVALO_S}s, por até ${HORAS}h. Nenhuma requisição ao PNCP.`)

let olhadas = 0
while (Date.now() < fim) {
  await sleep(INTERVALO_S * 1000)
  olhadas++

  if (coletorVivo() === false) {
    log(`ALARME: o coletor morreu (PID de .pipeline-pid não existe). Fila em ${base.pendentes}.`)
    process.exit(3)
  }

  let agora
  try {
    agora = await medir()
  } catch (e) {
    log(`banco não respondeu (${e.message}) — segue vigiando`)
    continue
  }

  const andou = agora.pendentes < base.pendentes
    || (agora.ultima_marca && (!base.ultima_marca || agora.ultima_marca > base.ultima_marca))
  if (andou) {
    const resolvidos = base.pendentes - agora.pendentes
    log(`ALARME: a fila ANDOU — ${resolvidos} resolvidos, restam ${agora.pendentes}.`)
    log(`última marca: ${agora.ultima_marca.toISOString()} (o PNCP voltou a responder)`)
    process.exit(0)
  }

  // Silêncio é o caso normal aqui; não poluir o log a cada 3min.
  if (olhadas % 20 === 0) log(`sem novidade — ${agora.pendentes} pendentes (${olhadas} olhadas)`)
}

log(`prazo de ${HORAS}h encerrado sem a fila andar. Fila em ${base.pendentes}.`)
process.exit(4)
