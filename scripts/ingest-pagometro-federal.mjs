// scripts/ingest-pagometro-federal.mjs — carga do PAGÔMETRO FEDERAL (Fase 2): dias entre
// liquidar e pagar fornecedor, por Unidade Gestora, a partir dos arquivos diários de
// despesa do Portal da Transparência (CGU). O cálculo mora em src/lib/pagometro-federal.mjs.
//
//   npm run pagometro:federal                         # continua de onde parou até anteontem
//   npm run pagometro:federal -- --desde 2025-07-01   # início da série (só vale com a série vazia)
//   npm run pagometro:federal -- --dry --desde 2026-09-01 --ate 2026-09-30   # sem banco: só mede
//   npm run pagometro:federal -- --so-resumo          # só recalcula a tabela pagometro_federal
//
// DIA A DIA, EM ORDEM, CADA DIA NUMA TRANSAÇÃO. O pagamento quita a liquidação mais antiga
// do empenho, então um dia não pode ser processado antes do anterior. Se a rodada cair no
// meio de um dia, a transação desfaz e o dia é refeito inteiro na próxima: nada é contado
// duas vezes.
//
// DIA QUE FALTA. A CGU publica com atraso de dias, e às vezes fora de ordem (medido em
// 04/10/2026: o de 30/09 saiu antes dos de 28 e 29/09). Dia sem arquivo há menos de
// PULAR_APOS_DIAS: a carga para ali e tenta de novo na próxima rodada. Mais velho que
// isso: é pulado (registrado com contagem nula) e a série segue.
//
// Volume: um ZIP de ~10 MB por dia útil (fim de semana ~20 KB). Baixado em memória, uma
// pausa entre um e outro, nada fica no disco.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { novoPool } from './lib/pg-ssl.mjs'
import { lerDoZip } from './lib/zip.mjs'
import { aplicarDia, eventosDoDia, resumirUg } from '../src/lib/pagometro-federal.mjs'
import { atualizarPagometroContratacoes } from './lib/pagometro-contratacoes.mjs'

const argv = process.argv.slice(2)
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const tem = (n) => argv.includes(n)
const DRY = tem('--dry')
const SO_RESUMO = tem('--so-resumo')
const SO_SCHEMA = tem('--so-schema')
const MAX_MIN = Number(arg('--max-min') ?? process.env.PAGOMETRO_MAX_MIN ?? 300)
const PAUSA_MS = Number(arg('--pausa-ms') ?? 3000)
const PULAR_APOS_DIAS = 15
const DESDE_PADRAO = '2025-07-01'

if (!DRY && !process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!DRY && !process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL_BASE = 'https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/despesas'
const UA = 'GovHealth/1.0 (pagometro; contato@techealth.com.br)'
const ARQUIVOS = {
  liquidacao: '_Despesas_Liquidacao.csv',
  liquidacaoEmpenhos: '_Despesas_Liquidacao_EmpenhosImpactados.csv',
  pagamento: '_Despesas_Pagamento.csv',
  pagamentoEmpenhos: '_Despesas_Pagamento_EmpenhosImpactados.csv',
}

const INICIO = Date.now()
const estourou = () => (Date.now() - INICIO) / 60_000 > MAX_MIN
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const diaIso = (d) => d.toISOString().slice(0, 10)
const maisDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return diaIso(d) }
const validarDia = (s, nome) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) { console.error(`ERRO: ${nome} inválido: ${s} (use AAAA-MM-DD)`); process.exit(1) } return s }

/** O maior ZIP diário medido tem ~13 MB; acima disto o download é recusado. */
const MAX_ZIP_BYTES = 100 * 1024 * 1024

/** Lê o corpo até MAX_ZIP_BYTES: nem o Content-Length nem o corpo podem passar disso. */
async function corpoLimitado(r) {
  const declarado = Number(r.headers.get('content-length') ?? 0)
  if (declarado > MAX_ZIP_BYTES) throw new Error(`ZIP de ${declarado} bytes, acima do teto de ${MAX_ZIP_BYTES}`)
  const partes = []
  let total = 0
  for await (const parte of r.body) {
    total += parte.length
    if (total > MAX_ZIP_BYTES) throw new Error(`ZIP passou de ${MAX_ZIP_BYTES} bytes no download`)
    partes.push(parte)
  }
  return Buffer.concat(partes.map((p) => Buffer.from(p)))
}

/** O servidor recusou de novo e de novo: a rodada para aqui e a próxima continua do dia. */
class ServidorRecusou extends Error {}

/**
 * O ZIP do dia, ou null se a CGU ainda não publicou (403/404).
 * 405/408/429/5xx são recusa passageira: medido em 05/10/2026, o servidor respondeu 405
 * à VPS depois de ~23 downloads seguidos com 1,5 s de pausa, e o mesmo arquivo baixou
 * normal minutos depois. Espera crescente (30 s → 4 min) e, persistindo, ServidorRecusou.
 */
async function baixarDia(dia) {
  const url = `${URL_BASE}/${dia.replace(/-/g, '')}_Despesas.zip`
  for (let tentativa = 1; ; tentativa++) {
    let status = 0
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180_000) })
      status = r.status
      if (r.status === 403 || r.status === 404) return null
      if (r.ok) return await corpoLimitado(r)
      await r.body?.cancel().catch(() => {})
    } catch (e) {
      if (/acima do teto|passou de/.test(String(e?.message))) throw e // grande demais: não adianta repetir
    }
    if (tentativa >= 4) throw new ServidorRecusou(`${dia}: servidor recusou ${tentativa} vezes (último HTTP ${status || 'sem resposta'})`)
    const espera = 30_000 * 2 ** (tentativa - 1)
    console.log(`  ${dia}: HTTP ${status || 'sem resposta'}, nova tentativa em ${espera / 1000}s`)
    await dormir(espera)
  }
}

function lerDia(buf) {
  const sufixos = Object.values(ARQUIVOS)
  const arqs = lerDoZip(buf, sufixos)
  const csv = {}
  for (const [k, suf] of Object.entries(ARQUIVOS)) {
    if (!arqs.has(suf)) throw new Error(`ZIP sem ${suf}`)
    csv[k] = arqs.get(suf).toString('latin1')
  }
  return eventosDoDia(csv)
}

// ── modo DRY: tudo em memória, sem banco ─────────────────────────────────────────────
async function dry(desde, ate) {
  const filas = new Map(), mensal = new Map(), nomes = new Map()
  for (let dia = desde; dia <= ate && !estourou(); dia = maisDias(dia, 1)) {
    await dormir(PAUSA_MS)
    const buf = await baixarDia(dia)
    if (!buf) { console.log(`  ${dia}: sem arquivo`); continue }
    const ev = lerDia(buf)
    for (const [ug, n] of ev.ugs) nomes.set(ug, n)
    for (const [k, m] of aplicarDia(filas, ev)) {
      const a = mensal.get(k)
      if (!a) mensal.set(k, m)
      else { a.pago += m.pago; a.pagoXdias += m.pagoXdias; a.semLiquidacao += m.semLiquidacao; a.pagamentos += m.pagamentos }
    }
    console.log(`  ${dia}: ${ev.liqs.length} liquidações, ${ev.pags.length} pagamentos de fornecedor`)
  }
  const porUg = new Map()
  for (const m of mensal.values()) { if (!porUg.has(m.ug)) porUg.set(m.ug, []); porUg.get(m.ug).push(m) }
  const t = [...mensal.values()].reduce((a, m) => ({ pago: a.pago + m.pago, px: a.px + m.pagoXdias, sem: a.sem + m.semLiquidacao }), { pago: 0, px: 0, sem: 0 })
  console.log(`[pagometro-federal] DRY total: pago casado ${t.pago.toFixed(2)} · pago×dias ${t.px.toFixed(2)} · sem liquidação ${t.sem.toFixed(2)}`)
  // Sem aquecimento no dry: a série é curta e é só para olhar os números.
  const linhas = [...porUg].map(([ug, ms]) => ({ ug, nome: nomes.get(ug)?.nome ?? '', ...resumirUg(ms, { inicioSerie: '1900-01-01' }) }))
  for (const u of linhas.filter((x) => x.dias != null).sort((a, b) => b.pago - a.pago).slice(0, 25)) {
    console.log(`  ${u.ug}  ${u.nome.slice(0, 46).padEnd(46)} ${String(u.dias).padStart(5)} dias  R$ ${(u.pago / 1e6).toFixed(1).padStart(7)} mi  casado ${Math.round(100 * (u.casado ?? 0))}%`)
  }
}

// ── carga de verdade ─────────────────────────────────────────────────────────────────
const pool = DRY ? null : novoPool(process.env.DATABASE_URL, { max: 2, connectionTimeoutMillis: 20_000 })
const q = async (sql, params = []) => (await pool.query(sql, params)).rows

async function processarDia(dia, ev) {
  const empenhos = [...new Set([...ev.liqs, ...ev.pags].map((e) => e.empenho))]
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const filas = new Map()
    const { rows } = await c.query(
      `SELECT empenho, ug, to_char(data, 'YYYY-MM-DD') AS data, saldo::float8 AS saldo
         FROM pagometro_fed_abertas WHERE empenho = ANY($1::text[]) ORDER BY empenho, ordem FOR UPDATE`,
      [empenhos],
    )
    for (const r of rows) { if (!filas.has(r.empenho)) filas.set(r.empenho, []); filas.get(r.empenho).push({ data: r.data, saldo: r.saldo, ug: r.ug }) }
    const mensal = aplicarDia(filas, ev)

    // As filas mexidas são regravadas inteiras: o que sobrou de cada empenho, em ordem.
    await c.query(`DELETE FROM pagometro_fed_abertas WHERE empenho = ANY($1::text[])`, [empenhos])
    const ab = { e: [], o: [], u: [], d: [], s: [] }
    for (const emp of empenhos) {
      (filas.get(emp) ?? []).forEach((l, i) => { ab.e.push(emp); ab.o.push(i); ab.u.push(l.ug); ab.d.push(l.data); ab.s.push(l.saldo) })
    }
    if (ab.e.length) {
      await c.query(
        `INSERT INTO pagometro_fed_abertas (empenho, ordem, ug, data, saldo)
         SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::date[], $5::numeric[])`,
        [ab.e, ab.o, ab.u, ab.d, ab.s],
      )
    }
    const ms = [...mensal.values()]
    if (ms.length) {
      await c.query(
        `INSERT INTO pagometro_fed_mensal (ug, ano, mes, pago, pago_x_dias, sem_liquidacao, pagamentos)
         SELECT * FROM unnest($1::text[], $2::int[], $3::int[], $4::numeric[], $5::numeric[], $6::numeric[], $7::int[])
         ON CONFLICT (ug, ano, mes) DO UPDATE SET
           pago = pagometro_fed_mensal.pago + EXCLUDED.pago,
           pago_x_dias = pagometro_fed_mensal.pago_x_dias + EXCLUDED.pago_x_dias,
           sem_liquidacao = pagometro_fed_mensal.sem_liquidacao + EXCLUDED.sem_liquidacao,
           pagamentos = pagometro_fed_mensal.pagamentos + EXCLUDED.pagamentos`,
        [ms.map((m) => m.ug), ms.map((m) => m.ano), ms.map((m) => m.mes), ms.map((m) => m.pago),
         ms.map((m) => m.pagoXdias), ms.map((m) => m.semLiquidacao), ms.map((m) => m.pagamentos)],
      )
    }
    const ugs = [...ev.ugs]
    if (ugs.length) {
      await c.query(
        `INSERT INTO pagometro_fed_ugs (ug, nome, orgao) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         ON CONFLICT (ug) DO UPDATE SET nome = EXCLUDED.nome, orgao = EXCLUDED.orgao`,
        [ugs.map(([u]) => u), ugs.map(([, n]) => n.nome), ugs.map(([, n]) => n.orgao)],
      )
    }
    await c.query(`INSERT INTO pagometro_fed_dias (dia, liquidacoes, pagamentos) VALUES ($1, $2, $3)`, [dia, ev.liqs.length, ev.pags.length])
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally { c.release() }
}

async function coletar(ate) {
  const ult = (await q(`SELECT to_char(max(dia), 'YYYY-MM-DD') AS d FROM pagometro_fed_dias`))[0]?.d
  let dia = ult ? maisDias(ult, 1) : validarDia(arg('--desde') ?? DESDE_PADRAO, '--desde')
  if (ult && arg('--desde')) console.log(`[pagometro-federal] série já começou (último dia ${ult}); --desde ignorado`)
  console.log(`[pagometro-federal] de ${dia} até ${ate}`)
  let feitos = 0, pulados = 0
  for (; dia <= ate; dia = maisDias(dia, 1)) {
    if (estourou()) { console.log(`[pagometro-federal] teto de ${MAX_MIN} min: continua na próxima rodada a partir de ${dia}`); break }
    await dormir(PAUSA_MS)
    let buf
    try { buf = await baixarDia(dia) } catch (e) {
      if (!(e instanceof ServidorRecusou)) throw e
      console.log(`[pagometro-federal] ${e.message}: para aqui e continua na próxima rodada`)
      break
    }
    if (!buf) {
      const idade = Math.round((Date.now() - Date.parse(`${dia}T12:00:00Z`)) / 86_400_000)
      if (idade <= PULAR_APOS_DIAS) { console.log(`[pagometro-federal] ${dia} ainda não publicado: para aqui e tenta na próxima rodada`); break }
      await q(`INSERT INTO pagometro_fed_dias (dia) VALUES ($1) ON CONFLICT DO NOTHING`, [dia])
      pulados++
      console.log(`  ${dia}: sem arquivo há ${idade} dias, pulado`)
      continue
    }
    const ev = lerDia(buf)
    await processarDia(dia, ev)
    feitos++
    if (feitos % 10 === 1) console.log(`  ${dia}: ${ev.liqs.length} liquidações, ${ev.pags.length} pagamentos de fornecedor (${((Date.now() - INICIO) / 60_000).toFixed(0)} min)`)
  }
  console.log(`[pagometro-federal] coleta: ${feitos} dias processados, ${pulados} pulados`)
}

async function resumir() {
  const inicio = (await q(`SELECT to_char(min(dia), 'YYYY-MM-DD') AS d FROM pagometro_fed_dias WHERE liquidacoes IS NOT NULL`))[0]?.d
  if (!inicio) { console.log('[pagometro-federal] série vazia: nada a resumir'); return }
  const rows = await q(
    `SELECT ug, ano, mes, pago::float8 AS pago, pago_x_dias::float8 AS "pagoXdias",
            sem_liquidacao::float8 AS "semLiquidacao", pagamentos FROM pagometro_fed_mensal`,
  )
  const porUg = new Map()
  for (const r of rows) { if (!porUg.has(r.ug)) porUg.set(r.ug, []); porUg.get(r.ug).push(r) }
  const res = [...porUg].map(([ug, ms]) => ({ ug, ...resumirUg(ms, { inicioSerie: inicio }) }))
  await q(
    `INSERT INTO pagometro_federal (ug, nome, orgao, dias, pago_periodo, pagamentos, casado, meses, mes_inicio, mes_fim, atualizado_em)
     SELECT r.ug, u.nome, u.orgao, r.dias, r.pago, r.pagamentos, r.casado, r.meses, r.ini, r.fim, now()
       FROM unnest($1::text[], $2::numeric[], $3::numeric[], $4::int[], $5::numeric[], $6::int[], $7::date[], $8::date[])
            AS r(ug, dias, pago, pagamentos, casado, meses, ini, fim)
       LEFT JOIN pagometro_fed_ugs u ON u.ug = r.ug
     ON CONFLICT (ug) DO UPDATE SET nome = EXCLUDED.nome, orgao = EXCLUDED.orgao, dias = EXCLUDED.dias,
       pago_periodo = EXCLUDED.pago_periodo, pagamentos = EXCLUDED.pagamentos, casado = EXCLUDED.casado,
       meses = EXCLUDED.meses, mes_inicio = EXCLUDED.mes_inicio, mes_fim = EXCLUDED.mes_fim, atualizado_em = now()`,
    [res.map((r) => r.ug), res.map((r) => r.dias), res.map((r) => r.pago), res.map((r) => r.pagamentos),
     res.map((r) => r.casado), res.map((r) => r.meses), res.map((r) => r.inicio), res.map((r) => r.fim)],
  )
  // Liquidação parada há mais de 400 dias não vai mais casar com nada: sai da fila.
  const velhas = await pool.query(`DELETE FROM pagometro_fed_abertas WHERE data < now() - interval '400 days'`)
  console.log(`[pagometro-federal] resumo: ${res.length} UGs, ${res.filter((r) => r.dias != null).length} com dias (série desde ${inicio}); ${velhas.rowCount ?? 0} liquidações velhas removidas da fila`)
}

async function main() {
  const ate = validarDia(arg('--ate') ?? maisDias(diaIso(new Date()), -2), '--ate')
  if (DRY) { await dry(validarDia(arg('--desde') ?? maisDias(ate, -6), '--desde'), ate); return }
  await q(fs.readFileSync(path.join(RAIZ, 'db', 'schema-pagometro.sql'), 'utf8'))
  if (SO_SCHEMA) { console.log('✓ schema do Pagômetro aplicado'); return }
  if (!SO_RESUMO) await coletar(ate)
  await resumir()
  // Roda todo dia: é também o que dá prazo às contratações que a coleta do PNCP trouxe
  // desde a rodada anterior (Fase 3: score, filtro e e-mail).
  await atualizarPagometroContratacoes(pool)
}

try { await main() } catch (e) {
  console.error('[pagometro-federal] falhou:', e)
  process.exitCode = 1
} finally { await pool?.end() }
