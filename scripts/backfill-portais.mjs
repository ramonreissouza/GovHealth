// scripts/backfill-portais.mjs — descobre o PORTAL de cada contratação já coletada.
//
// Lê /consulta/v1/orgaos/{cnpj}/compras/{ano}/{seq} e grava:
//   link_externo  ← linkSistemaOrigem (URL do portal; vem em ~44% dos casos)
//   usuario_nome  ← usuarioNome       (sistema publicador; vem em ~100%)
//   portal_backfill_em ← now()        (marca de visitado, para ser RESUMÍVEL)
//
// POR QUE É LENTO E RESUMÍVEL: medimos o PNCP devolvendo 429 já a ~1 req/s. Não há
// endpoint em lote que dê o portal por numeroControlePNCP (o de lista devolveria o
// universo inteiro do país para achar os nossos ~93 mil). Então é um pedido por
// registro, devagar, e o trabalho é dividido em várias execuções. Rodar de novo
// continua de onde parou; interromper com Ctrl+C é seguro.
//
// Uso:
//   node scripts/backfill-portais.mjs                  # roda até acabar a fila
//   node scripts/backfill-portais.mjs --limite=2000    # só 2000 registros nesta rodada
//   node scripts/backfill-portais.mjs --abertas        # prioriza abertas (o que a tela usa)
//   npm run portais:backfill -- --limite=2000

import fs from 'node:fs'
import pg from 'pg'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const LIMITE = Number(args.limite ?? 0) || Infinity
const SO_ABERTAS = !!args.abertas
const LOTE_DB = 200            // registros lidos do banco por vez
const GRAVA_A_CADA = 25        // flush das atualizações

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Controle ADAPTATIVO de taxa ─────────────────────────────────────────────
// Sobe devagar quando está indo bem, e recua forte a cada 429. Sem isso o PNCP
// corta a torneira e a rodada inteira vira erro.
let espera = 900               // ms entre pedidos
const ESPERA_MIN = 700
const ESPERA_MAX = 30000
let seguidasOk = 0

function aoSucesso() {
  seguidasOk++
  if (seguidasOk >= 20 && espera > ESPERA_MIN) { espera = Math.max(ESPERA_MIN, espera - 50); seguidasOk = 0 }
}
function aoLimite() {
  seguidasOk = 0
  espera = Math.min(ESPERA_MAX, Math.round(espera * 2))
}

let ok = 0, semDado = 0, falhas = 0, req429 = 0
const t0 = Date.now()

// Circuit-breaker: quando o PNCP entra em 429 sustentado, um registro pode consumir
// ~2 min só em recuos e NÃO gera gravação (falha total fica pendente para a próxima
// rodada). Sem isso a rodada "trava" em silêncio por horas — foi exatamente o que
// aconteceu depois de uma rajada de testes. Melhor encerrar e avisar.
const FALHAS_SEGUIDAS_MAX = 8
let falhasSeguidas = 0
class LimiteSustentado extends Error {}

async function buscar(r) {
  const url = `https://pncp.gov.br/api/consulta/v1/orgaos/${r.cnpj_orgao}/compras/${r.ano_compra}/${r.sequencial_compra}`
  for (let tent = 1; tent <= 4; tent++) {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
      if (resp.status === 429 || resp.status === 503) {
        req429++; aoLimite()
        await sleep(espera)
        continue
      }
      // 404 = contratação saiu do PNCP: marca visitado e não tenta de novo.
      if (resp.status === 404) return { visitado: true }
      if (!resp.ok) { await sleep(espera); continue }
      const j = await resp.json()
      aoSucesso()
      return {
        visitado: true,
        link: (j.linkSistemaOrigem ?? '').trim() || null,
        sistema: (j.usuarioNome ?? '').trim() || null,
      }
    } catch {
      aoLimite()
      await sleep(espera)
    }
  }
  return null   // esgotou tentativas: deixa pendente para a próxima rodada
}

async function gravar(pend) {
  if (!pend.length) return
  // Uma única instrução para o lote (UPDATE ... FROM valores) — o banco é remoto,
  // então evitar ida-e-volta por registro importa mais que a elegância do SQL.
  const vals = pend.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4}::boolean)`).join(',')
  const params = pend.flatMap((p) => [p.ncp, p.link, p.sistema, true])
  await db.query(
    `UPDATE contratacoes c SET
       link_externo = COALESCE(v.link, c.link_externo),
       usuario_nome = COALESCE(v.sistema, c.usuario_nome),
       portal_backfill_em = now()
     FROM (VALUES ${vals}) AS v(ncp, link, sistema, marca)
     WHERE c.numero_controle_pncp = v.ncp`,
    params,
  )
}

console.log(`[backfill-portais] iniciando | limite=${LIMITE === Infinity ? 'sem limite' : LIMITE} | ${SO_ABERTAS ? 'só abertas' : 'todas'}`)

let processados = 0
let pendGravar = []

try {
  while (processados < LIMITE) {
    const cond = [`portal_backfill_em IS NULL`, `cnpj_orgao <> ''`, `sequencial_compra IS NOT NULL`, `ano_compra IS NOT NULL`]
    if (SO_ABERTAS) cond.push(`NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)`)
    const { rows: fila } = await db.query(
      `SELECT numero_controle_pncp, cnpj_orgao, ano_compra, sequencial_compra
         FROM contratacoes c
        WHERE ${cond.join(' AND ')}
        ORDER BY data_publicacao DESC NULLS LAST
        LIMIT ${LOTE_DB}`)
    if (!fila.length) { console.log('[backfill-portais] fila vazia — histórico completo.'); break }

    for (const r of fila) {
      if (processados >= LIMITE) break
      const res = await buscar(r)
      processados++
      if (!res) {
        falhas++
        if (++falhasSeguidas >= FALHAS_SEGUIDAS_MAX) throw new LimiteSustentado()
      } else {
        falhasSeguidas = 0
        if (res.link || res.sistema) ok++; else semDado++
        pendGravar.push({ ncp: r.numero_controle_pncp, link: res.link ?? null, sistema: res.sistema ?? null })
      }
      if (pendGravar.length >= GRAVA_A_CADA) { await gravar(pendGravar); pendGravar = [] }

      if (processados % 100 === 0) {
        const min = (Date.now() - t0) / 60000
        const taxa = processados / (min * 60)
        const { rows: [f] } = await db.query(`SELECT count(*) n FROM contratacoes WHERE portal_backfill_em IS NULL`)
        const horas = taxa > 0 ? (Number(f.n) / taxa / 3600) : 0
        console.log(`  ${processados} nesta rodada | ok=${ok} sem-dado=${semDado} falhas=${falhas} 429=${req429} | ${taxa.toFixed(2)} req/s | espera=${espera}ms | restam ${f.n} (~${horas.toFixed(1)}h)`)
      }
      await sleep(espera)
    }
  }
  await gravar(pendGravar)
} catch (e) {
  await gravar(pendGravar).catch(() => {})
  pendGravar = []
  if (e instanceof LimiteSustentado) {
    console.warn(`[backfill-portais] PNCP recusando pedidos (${FALHAS_SEGUIDAS_MAX} registros seguidos falharam, ${req429} respostas 429/503).`)
    console.warn('[backfill-portais] encerrando a rodada de propósito — o progresso está salvo. Espere ~15min e rode de novo.')
  } else {
    console.error('[backfill-portais] interrompido:', e.message)
    process.exitCode = 1
  }
} finally {
  const { rows: [f] } = await db.query(
    `SELECT count(*) FILTER (WHERE portal_backfill_em IS NULL) pendentes,
            count(usuario_nome) com_sistema, count(link_externo) com_link FROM contratacoes`)
  console.log(`[backfill-portais] fim da rodada: ${processados} processados | ok=${ok} sem-dado=${semDado} falhas=${falhas} 429=${req429}`)
  console.log(`[backfill-portais] estado: pendentes=${f.pendentes} com_sistema=${f.com_sistema} com_link=${f.com_link}`)
  await db.end()
}
