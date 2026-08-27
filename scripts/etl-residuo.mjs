// scripts/etl-residuo.mjs — 3a PASSADA: o que a lista do PNCP não alcança.
//
// POR QUE EXISTE UMA TERCEIRA PASSADA
// A 2a passada (etl-enriquecer) varre o endpoint de LISTA, e está certa nisso: eram
// 238 mil contratações sem valor, e pelo detalhe (1 req/s) isso levaria dias. Mas a
// lista tem um limite que nenhuma paciência resolve — páginas que devolvem erro de
// forma DETERMINÍSTICA. Medido em 26 e 27/08/2026, duas rodadas independentes:
// abr/2025 mod8 morreu nas páginas 689-692 nas DUAS vezes, e fev/2025 mod8 na 772 nas
// duas. Recuar o checkpoint e insistir não muda: a página continua morta, e cada uma
// leva ~50 contratações consigo. Pior, quando uma frente morre no meio, tudo o que
// vem DEPOIS dela nunca é visitado — abr/2025 ficou com 1.697 sem valor porque a
// frente nunca passou da página 1.026.
//
// Esta passada inverte a fila: em vez de percorrer a paginação do PNCP e ver o que
// aparece, ela percorre a NOSSA lista de nulos e pede cada um pelo nome. Página ruim
// deixa de importar, porque não há paginação. O custo que tornava o detalhe inviável
// na 2a passada desapareceu junto com o volume: sobraram 3.856, não 238 mil.
//
// Medido antes de escrever (8 sondagens, estrada livre): 8 de 8 responderam entre
// 0,2s e 0,8s, e as 8 trouxeram valorTotalEstimado. O endpoint tem o dado que a
// lista não entregou.
//
// Só faz UPDATE de coluna NULA (COALESCE) — nunca sobrescreve dado coletado, e não
// toca em quem passou pelo limpar-ruido (valor_original preenchido).
// Restartável sem tabela de controle: a fila é a consulta, e quem ganha valor sai
// dela sozinho.
//
// Uso:
//   node scripts/etl-residuo.mjs                       (tudo que está NULL)
//   node scripts/etl-residuo.mjs --de=2024-01 --ate=2024-12
//   node scripts/etl-residuo.mjs --limite=200 --ensaio  (não grava, só relata)

import fs from 'node:fs'
import pg from 'pg'
import { pegar, soltar, soltarNaSaida, estado } from './pncp-lock.mjs'

if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d }
const DE = arg('de', null)
const ATE = arg('ate', null)
const LIMITE = Number(arg('limite', '0'))
// 800ms: as sondagens responderam em 0,2-0,8s, e o comentário da 2a passada registra
// que o detalhe devolve 429 já perto de 1 req/s. 800ms fica do lado seguro sem
// transformar 1h de trabalho em 3.
// 1500ms de partida, não 800: a 800ms o ensaio de 27/08/2026 levou 21 recusas em 21
// pedidos. O freio adaptativo chegaria lá sozinho, mas começar informado poupa uma
// dezena de recusas em cada execução. É o PISO — o freio sobe daqui, nunca desce abaixo.
const PAUSA = Number(arg('pausa', '1500'))
const ORCAMENTO_MIN = Number(arg('orcamento', '0'))   // 0 = sem teto
const ENSAIO = process.argv.includes('--ensaio')
const SEM_LOCK = process.argv.includes('--sem-lock')
const ESPERA_MAX_MIN = Number(arg('espera-max', '45'))

const CONSULTA = 'https://pncp.gov.br/api/consulta/v1'
const UA = 'GovHealth-ETL/1.0'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const log = (m) => console.log(`[residuo] ${m}`)

// ── banco: a mesma conexão que sobrevive a horas de varredura (ver 2a passada) ──
let client = null
async function conectar() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  // Sem este ouvinte, a queda vira 'unhandled error event' e mata o processo.
  c.on('error', (e) => { console.warn(`[residuo] conexão caiu: ${e.message}`); if (client === c) client = null })
  await c.connect()
  await c.query("SET statement_timeout = '300s'")
  return c
}
async function db(sql, args) {
  let ultimo
  for (let t = 0; t < 5; t++) {
    try {
      if (!client) client = await conectar()
      return await client.query(sql, args)
    } catch (e) {
      ultimo = e
      console.warn(`[residuo] banco: ${e.message} — reconectando (${t + 1}/5)`)
      try { await client?.end() } catch { /* já estava morta */ }
      client = null
      await sleep(2000 * (t + 1))
    }
  }
  throw new Error(`banco inacessível após 5 tentativas: ${ultimo?.message}`)
}

// ── PNCP: um pedido por contratação, pelo nome ────────────────────────────────
// TIMEOUT CURTO, NÃO LONGO. Medido em 27/08/2026 nas duas pontas do dia: às 22h BRT o
// detalhe respondia em 0,2-0,8s, 8 de 8; às 3h30 BRT, 11 de 12 passavam de 6s — e o
// mesmo padrão apareceu num grupo de controle de contratações que JÁ têm valor, então
// não é a população da fila, é o endpoint. Quando ele responde, responde rápido; quando
// pendura, esperar 30s não melhora nada e faz um registro ruim custar minutos. A
// primeira versão deste arquivo tinha 30s × 5 tentativas: 30 registros levaram 10min.
const TIMEOUT_MS = 6000
const TENTATIVAS = 3
// E quando TUDO está pendurando, moer a fila por horas é pior que voltar depois: a fila
// é a consulta, então desistir não perde posição nenhuma.
//
// DUAS GUARDAS, PORQUE UMA SÓ NÃO VÊ O CASO COMUM. A primeira versão contava só falhas
// SEGUIDAS, e no ensaio de 27/08/2026 ela não disparou com 35 falhas em 40 registros:
// os 5 acertos vinham espalhados e zeravam o contador toda hora. 12,5% de acerto moendo
// 13 minutos é exatamente o que a guarda deveria impedir. Então também se olha a TAXA,
// depois de um aquecimento que evite desistir por azar nos primeiros pedidos.
const SEGUIDAS_PARA_DESISTIR = Number(arg('desistir-apos', '15'))
const AQUECIMENTO = Number(arg('aquecimento', '20'))
const ACERTO_MINIMO = Number(arg('acerto-minimo', '0.25'))

let recusas = 0

// O PNCP DÁ A RÉGUA; A GENTE OBEDECE. No ensaio de 27/08/2026 vieram 21 recusas (429)
// em 21 pedidos a 800ms — o comentário da 2a passada já registrava que o detalhe recusa
// perto de 1 req/s. Recuar só naquele pedido não resolve, porque o próximo chega no
// mesmo ritmo e é recusado igual. Então a pausa GLOBAL sobe a cada recusa e desce
// devagar quando o endpoint volta a aceitar.
let pausaAtual = PAUSA
const PAUSA_TETO = 8000
let semRecusa = 0
function frear() {
  const nova = Math.min(Math.round(pausaAtual * 1.5), PAUSA_TETO)
  if (nova !== pausaAtual) log(`429 — freando de ${pausaAtual}ms para ${nova}ms`)
  pausaAtual = nova
  semRecusa = 0
}
function acelerar() {
  if (++semRecusa < 50 || pausaAtual <= PAUSA) return
  pausaAtual = Math.max(Math.round(pausaAtual * 0.8), PAUSA)
  log(`50 pedidos sem recusa — soltando para ${pausaAtual}ms`)
  semRecusa = 0
}

async function detalhe(cnpj, ano, seq, tentativa = 0) {
  const url = `${CONSULTA}/orgaos/${cnpj}/compras/${ano}/${Number(seq)}`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA },
                                 signal: AbortSignal.timeout(TIMEOUT_MS) })
    // 404 e 410 são RESPOSTA, não falha: o PNCP está dizendo que isto não está lá.
    // 410 ("Gone") é definitivo por definição, e no ensaio de 27/08/2026 apareceram 8
    // deles sendo tratados como erro retentável — 3 tentativas cada, para nada.
    if (r.status === 404 || r.status === 410) return { ausente: true, codigo: r.status }
    if (r.status === 429) { recusas++; frear(); throw new Error('429') }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return { dado: await r.json() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Recuo longo em 429 (é cota, e insistir rápido só queima), curto no resto (é
    // pendurada, e a próxima tentativa costuma responder na hora ou não responder).
    const espera = msg.includes('429') ? 5000 * 2 ** tentativa : 1000
    if (tentativa < TENTATIVAS - 1) { await sleep(espera); return detalhe(cnpj, ano, seq, tentativa + 1) }
    return { erro: msg }
  }
}

// Devolve quantas linhas o UPDATE casou. Em ensaio devolve o tamanho do lote: senão o
// contador ficaria zero e o teste de soma acusaria um buraco que não existe.
let naoCasaram = 0
async function gravar(lote) {
  if (!lote.length) return 0
  if (ENSAIO) return lote.length
  const vals = lote.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2}::numeric,$${i * 4 + 3},$${i * 4 + 4})`).join(',')
  const args = lote.flatMap((r) => [r.id, r.valor, r.modalidade, r.link])
  const res = await db(
    `UPDATE contratacoes c SET
       valor_total_estimado = COALESCE(c.valor_total_estimado, v.valor),
       modalidade_nome      = COALESCE(c.modalidade_nome, v.modalidade),
       link_externo         = COALESCE(c.link_externo, v.link)
     FROM (VALUES ${vals}) AS v(id, valor, modalidade, link)
     WHERE c.numero_controle_pncp = v.id AND c.valor_total_estimado IS NULL
       AND c.valor_original IS NULL`, args)
  const casaram = res.rowCount ?? 0
  // Linha que veio com valor do PNCP e não casou no UPDATE não pode sair da conta em
  // silêncio: alguém a preencheu entre a leitura da fila e a gravação, ou a condição
  // mudou. Sem este contador, a soma final fecharia mentindo.
  if (casaram < lote.length) naoCasaram += lote.length - casaram
  return casaram
}

// ── a pista: um dono só ───────────────────────────────────────────────────────
async function esperarPista() {
  if (SEM_LOCK) return true
  const inicio = Date.now()
  let n = 0
  while (estado().ocupado) {
    const e = estado()
    if (ESPERA_MAX_MIN && (Date.now() - inicio) / 60000 >= ESPERA_MAX_MIN) {
      log(`pista ainda ocupada por "${e.dono}" — desisto de hoje, a próxima execução retoma`)
      return false
    }
    log(`pista ocupada por "${e.dono}" — espera ${++n}, novo teste em 10min`)
    await sleep(10 * 60 * 1000)
  }
  pegar('etl-residuo')
  soltarNaSaida()
  return true
}

// ── fila ──────────────────────────────────────────────────────────────────────
const cond = ['valor_total_estimado IS NULL', 'valor_original IS NULL', 'numero_controle_pncp IS NOT NULL']
const params = []
if (DE) { params.push(`${DE}-01`); cond.push(`data_publicacao >= $${params.length}::date`) }
if (ATE) { params.push(`${ATE}-01`); cond.push(`data_publicacao < ($${params.length}::date + interval '1 month')`) }

if (!(await esperarPista())) { await client?.end(); process.exit(0) }

const fila = (await db(
  `SELECT numero_controle_pncp id FROM contratacoes
    WHERE ${cond.join(' AND ')}
    ORDER BY data_publicacao DESC NULLS LAST${LIMITE ? ` LIMIT ${LIMITE}` : ''}`, params)).rows

log(`${fila.length.toLocaleString('pt-BR')} contratações sem valor na fila`
  + (DE || ATE ? ` (${DE ?? 'início'} → ${ATE ?? 'hoje'})` : '')
  + ` · ~${(fila.length * (PAUSA + 500) / 3600000).toFixed(1)}h a ${PAUSA}ms de pausa inicial`
  + (ENSAIO ? ' · ENSAIO: não grava' : ''))

let preenchidos = 0, semValorNoPncp = 0, ausentes = 0, formatoRuim = 0, pedidos = 0
const falhas = new Map()
const lote = []
let orcamentoEstourou = false, desistiu = false, seguidas = 0, restaram = 0

for (let i = 0; i < fila.length; i++) {
  if (ORCAMENTO_MIN && (Date.now() - t0) / 60000 >= ORCAMENTO_MIN) {
    orcamentoEstourou = true
    log(`orçamento de ${ORCAMENTO_MIN}min esgotado em ${i} de ${fila.length} — a próxima execução retoma`)
    break
  }
  const id = fila[i].id
  // '13571334000167-1-000040/2026' → cnpj / sequencial / ano
  const m = id.match(/^(\d{14})-\d+-(\d+)\/(\d{4})$/)
  if (!m) { formatoRuim++; continue }
  const [, cnpj, seq, ano] = m

  const r = await detalhe(cnpj, ano, seq)
  pedidos++
  if (!r.erro) acelerar()
  await sleep(pausaAtual)

  if (r.ausente) { seguidas = 0; ausentes++; continue }
  if (r.erro) {
    falhas.set(r.erro, (falhas.get(r.erro) ?? 0) + 1)
    // O endpoint tem janelas ruins de horas (às 3h30 BRT, 11 de 12 penduram). Insistir
    // dentro delas gasta a madrugada para preencher quase nada. Desistir é grátis.
    const falhouAte = [...falhas.values()].reduce((a, b) => a + b, 0)
    const taxa = (pedidos - falhouAte) / Math.max(pedidos, 1)
    const motivo = ++seguidas >= SEGUIDAS_PARA_DESISTIR
      ? `${seguidas} falhas seguidas`
      : (pedidos >= AQUECIMENTO && taxa < ACERTO_MINIMO
          ? `só ${(taxa * 100).toFixed(0)}% de acerto em ${pedidos} pedidos`
          : null)
    if (motivo) {
      desistiu = true
      restaram = fila.length - (i + 1)
      log(`${motivo} — o PNCP está em janela ruim. Desisto com ${restaram} na fila;`
        + ` a próxima execução retoma (a fila é a consulta).`)
      break
    }
    continue
  }
  seguidas = 0

  const v = r.dado?.valorTotalEstimado
  if (v == null) {
    // O PNCP respondeu e não tem valor. Não é falha nossa e não melhora com
    // insistência — é o mesmo fenômeno dos zeros publicados na origem.
    semValorNoPncp++
    continue
  }
  lote.push({ id, valor: v, modalidade: r.dado.modalidadeNome ?? null,
              link: (r.dado.linkSistemaOrigem ?? '').trim() || null })

  if (lote.length >= 50) {
    preenchidos += await gravar(lote)
    lote.length = 0
    const min = (Date.now() - t0) / 60000
    log(`${i + 1}/${fila.length} · ${preenchidos} preenchidos · ${semValorNoPncp} sem valor no PNCP`
      + ` · ${ausentes} sumiram · ${[...falhas.values()].reduce((a, b) => a + b, 0)} falhas`
      + ` · ${recusas} recusas · ${(pedidos / Math.max(min * 60, 1)).toFixed(2)}/s`)
  }
}
preenchidos += await gravar(lote)

// ── fechamento que não esconde buraco ─────────────────────────────────────────
const falhou = [...falhas.values()].reduce((a, b) => a + b, 0)
log(`${ENSAIO ? 'ENSAIO — ' : ''}fim: ${preenchidos.toLocaleString('pt-BR')} ganharam valor`
  + ` · ${semValorNoPncp} o PNCP também não tem · ${ausentes} não existem mais lá`
  + ` · ${falhou} falharam · ${formatoRuim} com número fora do padrão`
  + (naoCasaram ? ` · ${naoCasaram} preenchidas por outro antes de nós` : '')
  + (restaram ? ` · ${restaram} deixadas para a próxima` : '')
  + ` · ${recusas} recusas (429) · ${((Date.now() - t0) / 60000).toFixed(0)}min`)
if (falhas.size) {
  log(`falhas por motivo: ${[...falhas].map(([k, n]) => `${k}×${n}`).join(', ')}`)
}
const tratados = preenchidos + naoCasaram + semValorNoPncp + ausentes + falhou + formatoRuim + restaram
// `restaram` entra na soma de propósito: assim o teste vale TAMBÉM no caminho de
// desistência, em vez de ser desligado justamente quando a rodada saiu pelo meio.
if (!orcamentoEstourou && tratados !== fila.length) {
  // A soma não fechar significa que alguém saiu da conta em silêncio — o defeito que
  // este projeto já pagou caro para descobrir, quatro vezes, em quatro scripts.
  console.warn(`[residuo] ! soma não fecha: ${tratados} tratados != ${fila.length} na fila`
    + ` (diferença ${fila.length - tratados})`)
}
const resta = (await db(`SELECT count(*)::int n FROM contratacoes WHERE valor_total_estimado IS NULL`)).rows[0].n
log(`ainda sem valor na base: ${resta.toLocaleString('pt-BR')}`)
if (!SEM_LOCK) soltar()
await client?.end()
