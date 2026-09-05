// scripts/backfill-itens.mjs — puxa itens e resultados do que JÁ está na base.
//
// O PROBLEMA: 294.131 contratações publicadas desde jan/2025 não têm um único item.
// A coleta histórica usou o endpoint de BUSCA do PNCP, que devolve só o cabeçalho, e
// a janela de 21 dias do refresh nunca alcança o passado. Sem item não há preço de
// referência, e sem item não há como pedir o resultado (ele é por item).
//
// POR QUE NÃO É O ETL DE NOVO: o etl-pncp varre a LISTA (páginas de 50 por UF ×
// modalidade × dia) e só então enriquece. Para o passado isso é pagar duas vezes —
// a lista nós já temos. Medido: as 294.131 têm cnpj_orgao, ano_compra e
// sequencial_compra COMPLETOS (zero nulos), que é exatamente a chave do endpoint de
// itens. Então dá para ir direto, sem re-varrer nada.
//
// POR QUE POR VALOR E NÃO POR PERÍODO: a concentração é brutal. Descontada a cauda
// de lixo (74 registros acima de R$ 1 bi), 7.701 contratações (2,8%) carregam
// R$ 493,8 bi — 79% do dinheiro; 40.102 (14,6%) carregam 95%. Puxar "2025 inteiro"
// custa 63h e traz sobretudo dispensa de baixo valor. Por isso o corte é --min e a
// ordem é valor DESC: interromper a qualquer momento significa parar no menos
// importante, nunca no meio do que importa.
//
// CHECKPOINT: é a própria consulta. Quem já tem item sai do SELECT na próxima
// rodada, então reiniciar retoma sozinho — sem tabela de controle para dessincronizar.
//
// Uso:
//   node scripts/backfill-itens.mjs --min=10000000          (>= R$ 10 mi)
//   node scripts/backfill-itens.mjs --min=1000000           (>= R$ 1 mi)
//   node scripts/backfill-itens.mjs --min=0 --limite=500    (amostra)
//   node scripts/backfill-itens.mjs --min=1000000 --sem-lock (o pai já segurou a pista)

import fs from 'node:fs'
import pg from 'pg'
import { soltar, soltarNaSaida } from './pncp-lock.mjs'
import { ceder, devoCeder, esperarVez, limparNaSaida } from './pncp-prioridade.mjs'

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d }
const MIN = Number(arg('min', '10000000'))
const LIMITE = Number(arg('limite', '0')) || null
const DELAY = Number(arg('delay', '120'))
const DESDE = arg('desde', '2025-01-01')
const SEM_LOCK = process.argv.includes('--sem-lock')
// ORÇAMENTO: para sozinho antes de virar problema para outra tarefa. O corte de
// R$ 1 mi são ~40 mil contratações e vários dias — sem teto, ele estaria no ar quando
// o refresh disparasse (de 3 em 3 dias, 22:00 BRT) e o refresh sairia de mão beijada,
// perdendo o ciclo inteiro. Com teto, ele para, solta a pista e a próxima execução
// retoma de onde parou: a consulta é o checkpoint, quem já tem item sai do SELECT.
// 0 = sem teto.
const ORCAMENTO_MIN = Number(arg('orcamento', '0'))

// ESPERA-MAX: se a pista estiver ocupada, NÃO fica de plantão indefinidamente. Esta
// tarefa roda todo dia; desistir hoje e voltar amanhã custa quase nada, enquanto
// esperar 20h faz o agendador matá-la no meio da espera — parece que quebrou, e o dia
// seguinte é gasto do mesmo jeito. 0 = espera para sempre.
const ESPERA_MAX_MIN = Number(arg('espera-max', '45'))

if (!process.env.DATABASE_URL) {
  const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const PNCP = 'https://pncp.gov.br/api/pncp/v1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ts = () => new Date().toLocaleString('pt-BR')
const log = (m) => console.log(`[backfill-itens] ${m}`)
const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })

// ── pista ────────────────────────────────────────────────────────────────────
// Espera o refresh/harvest soltarem antes de começar. Duas frentes no PNCP ao mesmo
// tempo dão 429 — medido em 21/08: 18x HTTP 429 e 14x 503 com os dois juntos, contra
// 4 quedas em 485 páginas rodando um de cada vez.
async function esperarPista() {
  if (SEM_LOCK) return true
  limparNaSaida()
  // Entra na fila com a prioridade mais baixa do pipeline, por mérito próprio: é o
  // único consumidor cujo trabalho não tem prazo e cuja fila é medida em centenas
  // de horas. Desistir aqui continua barato — a fila é recalculada do banco amanhã.
  if (!(await esperarVez('backfill-itens', { esperaMaxMin: ESPERA_MAX_MIN, log }))) return false
  soltarNaSaida()
  return true
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
// TIMEOUT CURTO DE PROPÓSITO — e é a decisão que torna este backfill viável.
// Medido em 25/08/2026: quando o endpoint de itens responde, ele responde em ~750ms;
// quando não responde, pendura até o timeout. E ele pendura MUITO — ~45% das
// chamadas. Não é tamanho de página nem rate-limit (não vem 429): a MESMA compra
// devolve 7 itens com tamanhoPagina=100, pendura com 20 e volta a responder com 10.
// É sorte. Com timeout de 20s, cada azar custava 20s de espera por uma conexão que
// nunca ia responder — 14 chamadas por contratação viravam ~5min. Com 3s, o azar
// custa 3s e a nova tentativa quase sempre passa. Mais tentativas, cada uma barata.
const TIMEOUT = Number(arg('timeout', '3000'))
const MAX_TENT = Number(arg('tentativas', '8'))

async function fetchJson(url, tentativa = 0) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
    // 404/204 = a compra realmente não tem itens. É resposta, não falha.
    if (res.status === 404 || res.status === 204) return null
    if ((res.status === 429 || res.status >= 500) && tentativa < MAX_TENT) {
      recusas++
      await sleep(1000 * (tentativa + 1)); return fetchJson(url, tentativa + 1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const txt = await res.text()
    return txt ? JSON.parse(txt) : null
  } catch (e) {
    pendurados++
    if (tentativa < MAX_TENT) { await sleep(400 * (tentativa + 1)); return fetchJson(url, tentativa + 1) }
    throw new Error(`desistiu após ${MAX_TENT} tentativas: ${e.message}`)
  }
}
// Distinguir "o PNCP disse que não tem" de "o PNCP não respondeu" importa: o primeiro
// é definitivo, o segundo volta na próxima rodada. Confundir os dois faz o log mentir.
async function fetchOuNulo(url) {
  try { return { dado: await fetchJson(url), falhou: false } }
  catch { return { dado: null, falhou: true } }
}

// ── DB que sobrevive ao PgBouncer ───────────────────────────────────────────
// Sem o ouvinte de 'error', a queda de uma conexão ociosa vira exceção não tratada e
// mata o processo — foi assim que o daemon do Radar morreu em 20/08.
function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', (e) => log(`conexão caiu: ${e.message} (reconecta sob demanda)`))
  return c
}
let db = novoDb()
await db.connect()

async function dbQuery(text, params, tent = 0) {
  try {
    return await db.query(text, params)
  } catch (e) {
    if (tent < 5) {
      log(`query falhou (${e.message.slice(0, 50)}) — reconectando ${tent + 1}/5`)
      try { await db.end() } catch { /* noop */ }
      db = novoDb()
      try { await db.connect() } catch { /* tenta de novo no retry */ }
      await sleep(1500 * (tent + 1))
      return dbQuery(text, params, tent + 1)
    }
    throw e
  }
}

// ── upserts (colados do etl-pncp para não divergir no mapeamento) ───────────
async function upsertItem(numeroControle, it) {
  await dbQuery(
    `INSERT INTO itens (numero_controle_pncp, numero_item, descricao, codigo_catmat, nome_catmat,
       quantidade, valor_unitario_estimado, situacao_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (numero_controle_pncp, numero_item) DO UPDATE SET
       situacao_item_id = EXCLUDED.situacao_item_id`,
    [numeroControle, it.numeroItem, it.descricao ?? null, it.catalogoCodigoItem ?? null,
     it.descricao ?? null, it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.situacaoCompraItem ?? null],
  )
}

async function upsertResultado(c, it, r) {
  if (!r.niFornecedor) return
  await dbQuery(
    `INSERT INTO resultados (numero_controle_pncp, numero_item, ni_fornecedor, nome_fornecedor,
       quantidade_homologada, valor_unitario_homologado, valor_total_homologado, data_resultado,
       ordem_classificacao_srp, porte_fornecedor, uf, codigo_catmat, nome_catmat, ano)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (numero_controle_pncp, numero_item, ni_fornecedor) DO UPDATE SET
       valor_total_homologado = EXCLUDED.valor_total_homologado,
       nome_fornecedor = EXCLUDED.nome_fornecedor`,
    [c.numero_controle_pncp, it.numeroItem, r.niFornecedor, r.nomeRazaoSocialFornecedor ?? null,
     r.quantidadeHomologada ?? null, r.valorUnitarioHomologado ?? null, r.valorTotalHomologado ?? null,
     (r.dataResultado ?? r.dataInclusao ?? '').slice(0, 10) || null, r.ordemClassificacaoSrp ?? null,
     r.porteFornecedorNome ?? null, c.uf ?? null, it.catalogoCodigoItem ?? null,
     it.descricao ?? null, c.ano_compra ?? null],
  )
}

// ── trabalho ─────────────────────────────────────────────────────────────────
let recusas = 0, pendurados = 0
let pedidos = 0, totI = 0, totR = 0, feitas = 0, vazias = 0, desistidas = 0

if (!(await esperarPista())) process.exit(0)

const { rows: fila } = await dbQuery(
  `SELECT numero_controle_pncp, cnpj_orgao, ano_compra, sequencial_compra, uf, valor_total_estimado
     FROM contratacoes x
    WHERE data_publicacao >= $1
      AND coalesce(valor_total_estimado, 0) >= $2
      AND cnpj_orgao IS NOT NULL AND ano_compra IS NOT NULL AND sequencial_compra IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM itens i WHERE i.numero_controle_pncp = x.numero_controle_pncp)
    ORDER BY valor_total_estimado DESC NULLS LAST
    ${LIMITE ? 'LIMIT ' + LIMITE : ''}`,
  [DESDE, MIN],
)

const t0 = Date.now()
log(`início ${ts()} — ${fila.length} contratações sem itens, valor >= R$ ${brl(MIN)}, desde ${DESDE}`)
// 7,2 pedidos por contratação e 0,30/s efetivos foram MEDIDOS no corte >= R$ 10 mi
// (1.150 contratações, 8.283 pedidos). Não são 2 req/s: o PNCP pendura ~48% das
// chamadas e o timeout de 3s de cada uma dessas entra na conta.
log(`estimativa: ~${Math.round(fila.length * 7.2).toLocaleString('pt-BR')} pedidos`
  + ` · ~${(fila.length * 7.2 / 0.3 / 3600).toFixed(1)}h a 0,30/s`)

let porOrcamento = false
for (const c of fila) {
  if (ORCAMENTO_MIN && (Date.now() - t0) / 60000 >= ORCAMENTO_MIN) { porOrcamento = true; break }
  // CEDER A PISTA. Este é o trabalho mais adiável do pipeline e o que segura a pista
  // por mais tempo: em 04/09/2026 a própria estimativa dele passou de ~245h para ~492h
  // no meio da rodada. Enquanto isso o sync-cobertura, que roda em minutos e guarda a
  // recência da base, desistia todo dia por encontrar a pista ocupada. Aqui é o ponto
  // certo de ceder: entre duas contratações não há nada em voo e nada a desfazer — a
  // fila é relida do banco na próxima execução de qualquer jeito.
  if (!SEM_LOCK && devoCeder('backfill-itens')) await ceder('backfill-itens', { log })
  const base = `${PNCP}/orgaos/${c.cnpj_orgao}/compras/${c.ano_compra}/${c.sequencial_compra}`
  const { dado: resp, falhou } = await fetchOuNulo(`${base}/itens?pagina=1&tamanhoPagina=100`)
  pedidos++
  await sleep(DELAY)

  // Desistiu: fica sem itens e volta na próxima rodada (a consulta é o checkpoint).
  if (falhou) { desistidas++; feitas++; continue }

  const itens = Array.isArray(resp) ? resp : (resp?.data ?? [])
  if (!itens.length) { vazias++; feitas++; continue }

  for (const it of itens) {
    await upsertItem(c.numero_controle_pncp, it); totI++
    // Só pede resultado de item que declara ter — pedir dos outros dobraria o custo
    // da varredura para receber lista vazia.
    if (it.temResultado || it.situacaoCompraItem === 2) {
      const { dado: arr } = await fetchOuNulo(`${base}/itens/${it.numeroItem}/resultados?pagina=1&tamanhoPagina=20`)
      pedidos++
      await sleep(DELAY)
      for (const r of (Array.isArray(arr) ? arr : (arr?.data ?? []))) { await upsertResultado(c, it, r); totR++ }
    }
  }
  feitas++

  if (feitas % 50 === 0) {
    const min = (Date.now() - t0) / 60000
    const rest = (fila.length - feitas) * (min / feitas)
    log(`${feitas}/${fila.length} · ${totI} itens · ${totR} resultados · ${pedidos} pedidos`
      + ` (${(pedidos / (min * 60)).toFixed(2)}/s · ${pendurados} penduradas · ${recusas} recusas)`
      + ` · ${vazias} sem itens · ${desistidas} desistidas · falta ~${(rest / 60).toFixed(1)}h`)
  }
}

const min = (Date.now() - t0) / 60000
log(`fim ${ts()} — ${feitas} contratações em ${min.toFixed(1)}min · ${totI} itens · ${totR} resultados`
  + ` · ${pedidos} pedidos (${pendurados} penduradas, ${recusas} recusas)`
  + ` · ${vazias} sem itens no PNCP · ${desistidas} desistidas (voltam na próxima rodada)`)
if (porOrcamento) {
  log(`PARADO PELO ORÇAMENTO de ${ORCAMENTO_MIN}min com ${fila.length - feitas} na fila`
    + ` — a próxima execução retoma daqui (a consulta é o checkpoint).`)
}
if (!SEM_LOCK) soltar()
await db.end()
