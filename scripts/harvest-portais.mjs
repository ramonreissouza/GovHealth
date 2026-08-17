// scripts/harvest-portais.mjs — descobre o PORTAL das contratações EM LOTE.
//
// POR QUE ESTE SCRIPT EXISTE (e substitui o backfill-portais.mjs na prática):
// o backfill lê o endpoint de DETALHE, 1 registro por pedido. Medimos o PNCP
// degradando de 4,8s para 7,2s por registro sob carga contínua — 76 mil abertas
// dariam ~140 horas. Mas o endpoint de LISTA devolve os MESMOS dois campos
// (`linkSistemaOrigem` e `usuarioNome`) para 50 registros de uma vez. São ~50x
// menos pedidos para o mesmo resultado.
//
// COMO FUNCIONA: varre (dia × modalidade) só nas combinações em que temos
// registros pendentes, do mais recente para o mais antigo. Baixa o universo
// nacional daquele dia/modalidade em páginas de 50 e casa `numeroControlePNCP`
// com o que está no nosso banco.
//
// RESUMÍVEL: o cursor de cada par (dia, modalidade) fica na tabela
// harvest_portais. Ctrl+C é seguro; rodar de novo continua de onde parou.
//
// Ao terminar um par, TODOS os nossos pendentes daquele par são marcados como
// visitados — inclusive os que não apareceram na lista nacional (saíram do PNCP).
// Sem isso eles seriam varridos para sempre.
//
// Uso:
//   node scripts/harvest-portais.mjs --abertas     # só as abertas (o que as telas usam)
//   node scripts/harvest-portais.mjs               # tudo, incluindo o histórico
//   node scripts/harvest-portais.mjs --pares=50    # limita esta rodada

import fs from 'node:fs'
import pg from 'pg'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const SO_ABERTAS = !!args.abertas
const LIMITE_PARES = Number(args.pares ?? 0) || Infinity
const TAM_PAGINA = 50          // teto do PNCP: 100+ devolve 400 "Tamanho de página inválido"

// Nome da modalidade no nosso banco → código do PNCP.
// 'LRE' (11 registros) não tem código mapeado; sobra para o backfill-portais.mjs.
const MODALIDADE_COD = {
  'Concorrência - Eletrônica': 4,
  'Concorrência - Presencial': 5,
  'Pregão - Eletrônico': 6,
  'Pregão': 7,
  'Dispensa': 8,
  'Dispensa de licitação': 8,
  'Inexigibilidade': 9,
  'Credenciamento': 12,
}

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

// POR QUE ESTE ENVELOPE DE BANCO EXISTE (medido em 17/08/2026, não suposto):
// um pg.Client só, aberto por horas contra o PgBouncer da VM pela rede pública e
// SEM timeout de consulta, PENDURA PARA SEMPRE quando a conexão vira half-open:
// não chega RST, o socket continua "aberto" e o await nunca volta. Sintomas
// medidos, os dois no mesmo dia: (1) coletor vivo há 27min com 1,05s de CPU
// acumulada, zero linha no log e zero escrita no banco; (2) antes disso, 153min
// de silêncio de madrugada — que eu li como "PNCP lento" e como "coletor no teto
// do rate-limiter". Não era nenhum dos dois: era uma consulta esperando um
// servidor que não ia responder nunca.
// O pipeline-noite.mjs JÁ SABIA disso — o comentário do medir() diz que "o
// PgBouncer da VM derruba conexão ociosa" e por isso o envolveu em repetição.
// Só o harvest, que é quem fica horas de pé, ficou sem a mesma proteção.
//
// query_timeout é client-side de propósito: statement_timeout viaja como
// parâmetro de startup e o PgBouncer recusa parâmetro que não conhece, então
// pedir ao servidor para se policiar quebraria a conexão em vez de protegê-la.
const CONEXAO = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,                 // o SO passa a detectar peer morto
  query_timeout: 180000,           // pendurado vira erro (folga p/ os counts grandes)
  connectionTimeoutMillis: 30000,
}

let db = new pg.Client(CONEXAO)
await db.connect()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Consulta com reconexão. Repetir é seguro: tudo aqui é UPSERT ou UPDATE por
 *  chave, então a mesma consulta duas vezes dá o mesmo estado final. */
async function consultar(sql, params, tentativas = 5) {
  let ultimo
  for (let t = 1; t <= tentativas; t++) {
    try {
      return await db.query(sql, params)
    } catch (e) {
      ultimo = e
      if (t === tentativas) break
      console.log(`[harvest] banco: ${e.code ?? e.message} — reconectando (${t}/${tentativas})`)
      try { await db.end() } catch {}
      await sleep(Math.min(30000, 3000 * t))
      db = new pg.Client(CONEXAO)
      try { await db.connect() } catch (e2) { ultimo = e2 }
    }
  }
  throw ultimo
}

await consultar(`
  CREATE TABLE IF NOT EXISTS harvest_portais (
    dia            DATE    NOT NULL,
    modalidade     INT     NOT NULL,
    pagina         INT     NOT NULL DEFAULT 1,
    total_paginas  INT,
    concluido      BOOLEAN NOT NULL DEFAULT false,
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (dia, modalidade)
  )`)

// ── Controle adaptativo de taxa ─────────────────────────────────────────────
// A lista responde em ~1s quando o PNCP está tranquilo, mas devolve 500/timeout
// sob carga. Começa devagar de propósito: uma rodada lenta que termina vale mais
// que uma rápida que toma bloqueio no meio.
let espera = 1500
const ESPERA_MIN = 800
const ESPERA_MAX = 60000
let seguidasOk = 0

// A recuperação tem que ser GEOMÉTRICA, igual à punição. Até 13/08/2026 ela era
// linear (-100ms a cada 15 acertos) contra uma punição de ×2, e essa assimetria
// prendia o coletor no teto: depois da queda do PNCP de 12-13/08 a espera ficou
// em 60.000ms e, para voltar aos 1.500ms, precisaria de (60000-1500)/100 = 585
// reduções × 15 acertos = 8.775 pedidos bem-sucedidos = 75h só de recuperação
// (simulado, não estimado). Era isso, e não a lentidão do PNCP, que produzia a
// projeção de "falta ~178h" com a API respondendo 8/8 a 1 req/s.
// ×0,7 a cada 5 acertos volta dos 60s aos 800ms em 65 pedidos (16,5min). Relaxar
// rápido é seguro porque a punição continua a um único erro de distância.
function aoSucesso() {
  seguidasOk++
  if (seguidasOk >= 5 && espera > ESPERA_MIN) {
    espera = Math.max(ESPERA_MIN, Math.round(espera * 0.7))
    seguidasOk = 0
  }
}
function aoLimite() {
  seguidasOk = 0
  espera = Math.min(ESPERA_MAX, Math.round(espera * 2))
}

const FALHAS_SEGUIDAS_MAX = 10
let falhasSeguidas = 0
class LimiteSustentado extends Error {}

let pedidos = 0, casados = 0, recusas = 0, paresFeitos = 0
const t0 = Date.now()

/** Busca uma página da lista nacional. Devolve {itens, totalPaginas} ou null se esgotou tentativas. */
async function buscarPagina(dia, modalidade, pagina) {
  const d = dia.replace(/-/g, '')
  const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao`
    + `?dataInicial=${d}&dataFinal=${d}&codigoModalidadeContratacao=${modalidade}`
    + `&pagina=${pagina}&tamanhoPagina=${TAM_PAGINA}`

  // 4 tentativas de 20s, não 6 de 45s: quando o PNCP está fora, o objetivo é
  // DESISTIR RÁPIDO para o circuit-breaker encerrar a rodada e o executor da noite
  // entrar na espera de 15min. Com 6×45s a rodada levava ~45min só para constatar
  // que estava fora — tempo que não vira nenhum registro coletado.
  for (let tent = 1; tent <= 4; tent++) {
    pedidos++
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      // 204 = dia/modalidade sem nada publicado. É resposta legítima, não erro.
      if (resp.status === 204) { aoSucesso(); return { itens: [], totalPaginas: 0 } }
      if (resp.status === 429 || resp.status === 500 || resp.status === 503) {
        recusas++; aoLimite(); await sleep(espera); continue
      }
      if (!resp.ok) { aoLimite(); await sleep(espera); continue }
      const j = await resp.json()
      aoSucesso()
      return { itens: j.data ?? [], totalPaginas: j.totalPaginas ?? 0 }
    } catch {
      recusas++; aoLimite(); await sleep(espera)
    }
  }
  return null
}

/** Casa os itens da lista nacional com os NOSSOS registros. Só toca no que é nosso. */
async function gravar(itens) {
  const uteis = itens.filter((i) => i.numeroControlePNCP && (i.linkSistemaOrigem || i.usuarioNome))
  if (!uteis.length) return 0
  const vals = uteis.map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`).join(',')
  const params = uteis.flatMap((i) => [
    i.numeroControlePNCP,
    (i.linkSistemaOrigem ?? '').trim() || null,
    (i.usuarioNome ?? '').trim() || null,
  ])
  const { rowCount } = await consultar(
    `UPDATE contratacoes c SET
       link_externo = COALESCE(v.link, c.link_externo),
       usuario_nome = COALESCE(v.sistema, c.usuario_nome),
       portal_backfill_em = now()
     FROM (VALUES ${vals}) AS v(ncp, link, sistema)
     WHERE c.numero_controle_pncp = v.ncp`,
    params,
  )
  return rowCount
}

/** Fecha o par: o que não apareceu na lista nacional saiu do PNCP — marca visitado. */
async function fecharPar(dia, modalidade, nomes) {
  await consultar(
    `UPDATE contratacoes SET portal_backfill_em = now()
      WHERE portal_backfill_em IS NULL
        AND data_publicacao::date = $1
        AND modalidade_nome = ANY($2)`,
    [dia, nomes],
  )
  await consultar(
    `UPDATE harvest_portais SET concluido = true, atualizado_em = now()
      WHERE dia = $1 AND modalidade = $2`, [dia, modalidade])
}

// ── Fila de trabalho ────────────────────────────────────────────────────────
// Pares (dia, modalidade) com pendentes, do mais recente para o mais antigo.
// A ordem cronológica inversa é o que faz "--abertas" render valor primeiro:
// as licitações que as telas mostram são justamente as publicadas há pouco.
const nomesPorCodigo = new Map()
for (const [nome, cod] of Object.entries(MODALIDADE_COD)) {
  if (!nomesPorCodigo.has(cod)) nomesPorCodigo.set(cod, [])
  nomesPorCodigo.get(cod).push(nome)
}

const condAberta = SO_ABERTAS
  ? `AND NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)`
  : ``

const { rows: fila } = await consultar(
  `SELECT to_char(c.data_publicacao::date, 'YYYY-MM-DD') dia, c.modalidade_nome, count(*) n
     FROM contratacoes c
    WHERE c.portal_backfill_em IS NULL
      AND c.data_publicacao IS NOT NULL
      AND c.modalidade_nome = ANY($1)
      ${condAberta}
    GROUP BY 1, 2
    ORDER BY 1 DESC`,
  [Object.keys(MODALIDADE_COD)],
)

// Agrupa por (dia, código) porque dois nomes nossos podem cair no mesmo código
// do PNCP ('Dispensa' e 'Dispensa de licitação' são ambos 8) — seria varrer duas vezes.
const pares = new Map()
for (const r of fila) {
  const cod = MODALIDADE_COD[r.modalidade_nome]
  const k = `${r.dia}|${cod}`
  const at = pares.get(k) ?? { dia: r.dia, cod, n: 0 }
  at.n += Number(r.n)
  pares.set(k, at)
}
const trabalho = [...pares.values()]

console.log(`[harvest] ${trabalho.length} pares (dia × modalidade) na fila | ${SO_ABERTAS ? 'SÓ ABERTAS' : 'TUDO'}`)
console.log(`[harvest] ${trabalho.reduce((a, p) => a + p.n, 0)} registros nossos a resolver | página de ${TAM_PAGINA}`)

try {
  for (const par of trabalho) {
    if (paresFeitos >= LIMITE_PARES) break

    const { rows: [cur] } = await consultar(
      `INSERT INTO harvest_portais (dia, modalidade) VALUES ($1, $2)
       ON CONFLICT (dia, modalidade) DO UPDATE SET atualizado_em = now()
       RETURNING pagina, concluido`, [par.dia, par.cod])
    if (cur.concluido) { paresFeitos++; continue }

    let pagina = cur.pagina
    let totalPaginas = null

    while (totalPaginas === null || pagina <= totalPaginas) {
      const res = await buscarPagina(par.dia, par.cod, pagina)
      if (!res) {
        if (++falhasSeguidas >= FALHAS_SEGUIDAS_MAX) throw new LimiteSustentado()
        break   // desiste deste par nesta rodada; o cursor ficou salvo
      }
      falhasSeguidas = 0
      totalPaginas = res.totalPaginas
      if (!res.itens.length) break

      casados += await gravar(res.itens)
      pagina++
      await consultar(`UPDATE harvest_portais SET pagina = $3, total_paginas = $4, atualizado_em = now()
                       WHERE dia = $1 AND modalidade = $2`, [par.dia, par.cod, pagina, totalPaginas])
      await sleep(espera)
    }

    if (totalPaginas !== null && pagina > totalPaginas) {
      await fecharPar(par.dia, par.cod, nomesPorCodigo.get(par.cod))
    }
    paresFeitos++

    if (paresFeitos % 10 === 0) {
      const min = (Date.now() - t0) / 60000
      const { rows: [f] } = await consultar(`SELECT count(*) n FROM contratacoes WHERE portal_backfill_em IS NULL`)
      const porPar = paresFeitos / min
      const horas = porPar > 0 ? (trabalho.length - paresFeitos) / porPar / 60 : 0
      console.log(`  ${paresFeitos}/${trabalho.length} pares | ${casados} casados | ${pedidos} pedidos `
        + `(${(pedidos / (min * 60)).toFixed(2)}/s, ${recusas} recusas) | espera=${espera}ms `
        + `| pendentes=${f.n} | falta ~${horas.toFixed(1)}h`)
    }
  }
} catch (e) {
  if (e instanceof LimiteSustentado) {
    console.warn(`[harvest] PNCP recusando (${FALHAS_SEGUIDAS_MAX} páginas seguidas falharam, ${recusas} recusas).`)
    console.warn('[harvest] encerrando de propósito — o cursor está salvo. Espere ~15min e rode de novo.')
  } else {
    console.error('[harvest] interrompido:', e.message)
    process.exitCode = 1
  }
} finally {
  const min = (Date.now() - t0) / 60000
  const { rows: [f] } = await consultar(
    `SELECT count(*) FILTER (WHERE portal_backfill_em IS NULL) pendentes,
            count(usuario_nome) com_sistema, count(link_externo) com_link FROM contratacoes`)
  console.log(`[harvest] fim: ${paresFeitos} pares | ${casados} casados | ${pedidos} pedidos em ${min.toFixed(1)}min `
    + `(${(pedidos / (min * 60)).toFixed(2)}/s) | ${recusas} recusas`)
  console.log(`[harvest] estado: pendentes=${f.pendentes} com_sistema=${f.com_sistema} com_link=${f.com_link}`)
  await db.end()
}
