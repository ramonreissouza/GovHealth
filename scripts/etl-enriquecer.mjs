// scripts/etl-enriquecer.mjs — 2a PASSADA: preenche o valor que a coleta não trouxe.
//
// A coleta histórica usa o endpoint de BUSCA do PNCP (/api/search), o único que
// aguenta varrer o país inteiro — mas ele NÃO devolve `valorTotalEstimado`. Ficaram
// 238.036 das 331.177 contratações com valor NULL. Não é que sejam pequenas nem que
// o dado não exista: conferido em amostra, o PNCP tem o valor de todas elas
// (R$ 1,05M, R$ 678k, R$ 758k…). Enquanto falta, a licitação some das telas que
// filtram/ordenam por valor e o ticket médio fica sem base.
//
// POR QUE PELA LISTA E NÃO PELO DETALHE
// O caminho óbvio seria pedir o detalhe de cada uma (/orgaos/{cnpj}/compras/{ano}/{seq}).
// Medido: esse endpoint devolve 429 já a 1 req/s — 238 mil chamadas levariam dias, e
// a rajada ainda derruba o acesso por um tempo. A LISTA
// (/contratacoes/publicacao, 50 por página) não sofre o mesmo limite: 8 páginas
// seguidas a 400 ms passaram todas. Um mês do país inteiro ≈ 2.700 páginas, e o
// período que precisamos (2024-01 → hoje) ≈ 50 mil requisições — ~5 h em vez de dias.
// Em troca ela traz o país todo e não só saúde; só usamos o que já está na base.
//
// Só faz UPDATE de colunas NULAS (COALESCE) — nunca sobrescreve dado coletado.
// Restartável: o progresso vai para etl_checkpoint por (mês, modalidade).
//
// Uso:
//   node scripts/etl-enriquecer.mjs                    (2025-01 até hoje)
//   node scripts/etl-enriquecer.mjs --de=2026-01 --ate=2026-08
//   node scripts/etl-enriquecer.mjs --conc=6 --pausa=250

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
// Começa em 2025: medido na base, 2024 tem 1.469 contratações sem valor contra
// 186.665 de 2025 e 49.477 de 2026. Varrer 2024 custa ~20 mil requisições para
// alcançar 0,6% do que falta.
const DE = arg('de', '2025-01')
const ATE = arg('ate', new Date().toISOString().slice(0, 7))
const PAUSA = Number(arg('pausa', '400'))
// Frentes simultâneas. Fica em 1 por medição, não por conservadorismo: com 4 o PNCP
// devolveu 429 em 22 das 27 primeiras frentes. Uma requisição por vez passa sempre.
const CONC = Number(arg('conc', '1'))
const BASE = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao'
const UA = 'GovHealth-ETL/1.0'

// A PISTA DO PNCP TEM UM DONO SÓ — E ESTE SCRIPT ERA O ÚNICO QUE NÃO PERGUNTAVA.
// Todos os outros consumidores pesados (pipeline-noite, etl-refresh-loop,
// harvest-portais, backfill-itens/antigos) passam pelo pncp-lock; este não passava, e
// por isso conseguia entrar por cima de quem já estava na pista. Medido em 26/08/2026,
// rodando junto do backfill de itens: as chamadas penduradas do backfill saltaram de
// ~500 a cada 200 contratações para ~1.800, as desistências foram de 23 para 37, e
// esta passada tirou ZERO de fev/2025 — cinco páginas seguidas estourando o timeout de
// 60s, inclusive a página 1, que responde em 6-9s com a pista livre. Os dois lados
// pioraram e nenhum dos dois avançou.
const SEM_LOCK = process.argv.includes('--sem-lock')
// Mesma razão do backfill-itens: ficar de plantão indefinidamente faz o agendador
// matar a tarefa no meio da espera, e o dia é gasto do mesmo jeito. 0 = para sempre.
const ESPERA_MAX_MIN = Number(arg('espera-max', '45'))

// Modalidades da Lei 14.133 que aparecem na saúde. 8 (dispensa) e 6 (pregão) são o
// grosso; as outras somam pouco mas custam poucas páginas.
const MODALIDADES = [1, 4, 5, 6, 8, 9, 12, 13]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// CONEXÃO QUE SOBREVIVE ÀS HORAS DE VARREDURA
// A primeira tentativa desta passada morreu em "Connection terminated unexpectedly"
// logo no começo: um único pg.Client segurado por horas atrás do PgBouncer cai, e o
// evento 'error' sem ouvinte derruba o processo inteiro — 5 h de coleta perdidas
// porque o banco piscou. Agora cada consulta reconecta se precisar.
let client = null

async function conectar() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  // Sem este ouvinte, a queda vira 'unhandled error event' e mata o processo.
  c.on('error', (e) => { console.warn(`[enriq] conexão caiu: ${e.message}`); if (client === c) client = null })
  await c.connect()
  // Depois do connect, nunca como parâmetro de startup: o PgBouncer rejeita.
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
      console.warn(`[enriq] banco: ${e.message} — reconectando (${t + 1}/5)`)
      try { await client?.end() } catch { /* já estava morta */ }
      client = null
      await sleep(2000 * (t + 1))
    }
  }
  throw new Error(`banco inacessível após 5 tentativas: ${ultimo?.message}`)
}

const ymd = (mes, dia) => `${mes.replace('-', '')}${dia}`
const ultimoDia = (mes) => {
  const [a, m] = mes.split('-').map(Number)
  return String(new Date(a, m, 0).getDate()).padStart(2, '0')
}

function meses(de, ate) {
  const out = []
  let [a, m] = de.split('-').map(Number)
  const [aF, mF] = ate.split('-').map(Number)
  while (a < aF || (a === aF && m <= mF)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; a++ }
  }
  return out
}

async function pagina(mes, mod, pag, tentativa = 0) {
  const url = `${BASE}?dataInicial=${ymd(mes, '01')}&dataFinal=${ymd(mes, ultimoDia(mes))}`
    + `&codigoModalidadeContratacao=${mod}&pagina=${pag}&tamanhoPagina=50`
  // 60s, não 30: medido, a lista do PNCP leva 6-9s por página em condição normal e
  // passa disso com várias frentes abertas. Com 30s o abort virava "furo" e a frente
  // era abandonada inteira — foi o que aconteceu na primeira tentativa em paralelo.
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60000)
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: ac.signal })
    if (r.status === 204) return { data: [], totalPaginas: 0 }
    // 429 é limite de taxa, NÃO ausência de dado: recua e tenta de novo. Tratar como
    // falha definitiva marcaria como "sem valor" registros que o PNCP tem.
    if (r.status === 429) throw new Error('429')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } catch (e) {
    // Recuo mais longo em 429: 2s não devolvia a cota, e as 5 tentativas queimavam em
    // 30s. Agora vai a 5/10/20/40/80s.
    const espera = String(e).includes('429') ? 5000 * 2 ** tentativa : 2000 * (tentativa + 1)
    if (tentativa < 5) { await sleep(espera); return pagina(mes, mod, pag, tentativa + 1) }
    // Desistir em silêncio escondia a razão: a frente inteira era abandonada e o log
    // só mostrava "concluída". O motivo importa — 429 pede menos frentes, timeout pede
    // mais paciência.
    console.warn(`[enriq] furo em ${mes}/mod${mod} pág ${pag}: ${e instanceof Error ? e.message : e}`)
    return null
  } finally { clearTimeout(timer) }
}

const lerCp = async (chave) => Number(
  (await db(`SELECT ultima_pagina FROM etl_checkpoint WHERE chave = $1`, [chave])).rows[0]?.ultima_pagina ?? 0)
const salvarCp = (chave, p) => db(
  `INSERT INTO etl_checkpoint (chave, ultima_pagina, atualizado_em) VALUES ($1,$2,now())
   ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`, [chave, p])

/** UPDATE em lote: só toca linhas que existem na base E estão sem valor.
 *
 * NÃO RESSUSCITAR VALOR NEUTRALIZADO. `valor_original IS NOT NULL` marca registro
 * que limpar-ruido.mjs já julgou impossível (erro de digitação de quem publicou no
 * PNCP: credenciamento de R$ 29 tri, município de 20 mil habitantes com registro de
 * preços de R$ 9,8 bi). A neutralização põe NULL no valor — que é exatamente a
 * condição que este UPDATE procura, então sem esta guarda ele repõe o absurdo na
 * passada seguinte. Medido em 11/08/2026: os 6 registros neutralizados estavam
 * TODOS de volta, com o valor original intacto. */
async function gravar(lote) {
  if (!lote.length) return 0
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
  return res.rowCount ?? 0
}

const lista = meses(DE, ATE)
// Cada par (mês, modalidade) é independente e tem checkpoint próprio — dá para
// rodar vários ao mesmo tempo. Medido em série: ~9 req/min, porque a lista do PNCP
// leva ~6s por página e a pausa é irrelevante perto disso; as ~50 mil páginas
// levariam DIAS. O gargalo é espera de rede, não taxa.
async function esperarPista() {
  if (SEM_LOCK) return true
  const inicio = Date.now()
  let n = 0
  while (estado().ocupado) {
    const e = estado()
    if (ESPERA_MAX_MIN && (Date.now() - inicio) / 60000 >= ESPERA_MAX_MIN) {
      console.log(`[enriq] pista ainda ocupada por "${e.dono}" — desisto de hoje,`
        + ` a próxima execução retoma do checkpoint`)
      return false
    }
    console.log(`[enriq] pista ocupada por "${e.dono}" — espera ${++n}, novo teste em 10min`)
    await sleep(10 * 60 * 1000)
  }
  pegar('etl-enriquecer')
  soltarNaSaida()
  return true
}

// Sair aqui é seguro e barato: o progresso está em etl_checkpoint por (mês, modalidade),
// então a próxima execução retoma na página exata onde esta pararia.
if (!(await esperarPista())) { await client?.end(); process.exit(0) }

const pares = lista.flatMap((mes) => MODALIDADES.map((mod) => ({ mes, mod })))
console.log(`[enriq] ${lista.length} mês(es) × ${MODALIDADES.length} modalidades = ${pares.length} frentes · ${DE} → ${ATE} · ${CONC} em paralelo · pausa ${PAUSA}ms`)
let reqs = 0, vistos = 0, gravados = 0, furos = 0, feitas = 0, pulos = []
const t0 = Date.now()

async function varrer({ mes, mod }) {
  const chave = `enriq:${mes}:${mod}`
  let pag = await lerCp(chave)
  if (pag === -1) return                           // já concluído
  let seguidos = 0
  for (;;) {
    pag++
    const j = await pagina(mes, mod, pag)
    reqs++
    if (j === null) {
      furos++
      // PULAR, não abandonar. Uma página que morre após 5 tentativas costuma ser
      // PERMANENTE: o endpoint de lista devolve 500 em offset fundo (pág 379 = registro
      // 18.950) e devolve para sempre. Até 26/08/2026 isto dava `break` com o checkpoint
      // parado na página ruim — então a execução seguinte lia o mesmo número, tomava o
      // mesmo 500 e desistia de novo. Quatro frentes de Pregão Eletrônico estavam
      // congeladas assim: 2025-02 na pág 771 (desde 20/08), 2025-04 na 378 (19/08),
      // 2026-03 na 1008 (20/08), 2025-11 na 78 — 15.483 contratações sem valor que
      // NENHUMA execução futura ia buscar, porque o script relatava "✓ Fim" e 0 furos
      // fatais. Agora anda por cima da página ruim; só encerra se várias seguidas
      // furarem, aí é fim de dados de verdade ou o PNCP fora do ar.
      await salvarCp(chave, pag)
      pulos.push(`${mes}/mod${mod}:${pag}`)
      if (++seguidos >= 5) {
        console.warn(`[enriq] ${mes}/mod${mod}: 5 páginas seguidas furaram na ${pag} — encerrando a frente`)
        break
      }
      await sleep(PAUSA)
      continue
    }
    seguidos = 0
    const itens = j.data ?? []
    if (!itens.length) { await salvarCp(chave, -1); break }
    vistos += itens.length
    const lote = itens
      .filter((x) => x.numeroControlePNCP && x.valorTotalEstimado != null)
      // `.trim() || null` e não `?? null`: o PNCP devolve linkSistemaOrigem como
      // string VAZIA com frequência, e `?? null` gravava o '' no banco. Medido em
      // 13/08/2026: 40.772 registros com link_externo = '' — que contam como
      // "tem link" em qualquer count(link_externo) e não resolvem portal nenhum.
      .map((x) => ({ id: x.numeroControlePNCP, valor: x.valorTotalEstimado,
                     modalidade: x.modalidadeNome ?? null,
                     link: (x.linkSistemaOrigem ?? '').trim() || null }))
    gravados += await gravar(lote)
    await salvarCp(chave, pag)
    if (pag >= (j.totalPaginas ?? pag)) { await salvarCp(chave, -1); break }
    await sleep(PAUSA)
  }
}

const fila = pares.slice()
await Promise.all(Array.from({ length: CONC }, async () => {
  for (;;) {
    const p = fila.shift()
    if (!p) return
    await varrer(p)
    feitas++
    const min = (Date.now() - t0) / 60000
    console.log(`[enriq] ${p.mes}/mod${p.mod} · ${feitas}/${pares.length} frentes · ${reqs} req · `
      + `${vistos.toLocaleString('pt-BR')} vistos · ${gravados.toLocaleString('pt-BR')} preenchidos · `
      + `${furos} furo(s) · ${Math.round(reqs / Math.max(min, 0.01))} req/min`)
  }
}))

const falta = (await db(`SELECT count(*)::int n FROM contratacoes WHERE valor_total_estimado IS NULL`)).rows[0].n
console.log(`✓ Fim: ${gravados.toLocaleString('pt-BR')} contratações ganharam valor. Ainda sem valor: ${falta.toLocaleString('pt-BR')}. Páginas que furaram: ${furos}.`)
// as páginas puladas são ~50 registros cada que ninguém mais vai buscar: sem isso
// impresso, o "✓ Fim" esconde o buraco. Zerar o checkpoint da frente é como retomá-las.
if (pulos.length) console.warn(`[enriq] páginas puladas (${pulos.length}): ${pulos.join(', ')}`)
if (!SEM_LOCK) soltar()
await client?.end()
