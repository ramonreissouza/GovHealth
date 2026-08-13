// scripts/pipeline-noite.mjs — encadeia as três frentes que dependem do PNCP,
// UMA DE CADA VEZ, na ordem de valor:
//
//   FASE 1  portais das ABERTAS   (harvest-portais.mjs --abertas)
//   FASE 2  valores 2025 e 2026   (etl-enriquecer.mjs + limpar-ruido.mjs)
//   FASE 3  portais do HISTÓRICO  (harvest-portais.mjs)
//
// POR QUE UM DONO SÓ: o PNCP degrada com concorrência. Rodar o harvest e o
// enriquecedor ao mesmo tempo foi o que produziu os "furos" de 12/08 — as
// passadas 2 e 3 do enriquecedor voltaram sem gravar nada, e as 20 frentes
// travadas não andaram um registro. Serializar é mais rápido que paralelizar
// contra um servidor que corta a torneira.
//
// Substitui o harvest-noite.mjs enquanto roda (não suba os dois).
//
// Uso:
//   node scripts/pipeline-noite.mjs
//   npm run pipeline:noite
//
// Ctrl+C é seguro em qualquer ponto: o harvest guarda o cursor por par
// (dia, modalidade) e o enriquecedor guarda checkpoint por (mês, modalidade).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'

const ESPERA_RECUSA = 15 * 60 * 1000   // PNCP recusando: espera longa
const ESPERA_NORMAL = 60 * 1000        // rodada produtiva que parou por outro motivo
const PASSADAS_VALOR = 3               // passadas do enriquecedor por janela

const JANELAS = [
  { de: '2025-01', ate: '2025-12' },   // 2025 primeiro: é onde está o passivo
  { de: '2026-01', ate: '2026-08' },
]

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hora = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[pipeline] ${hora()} ${m}`)

/** Contagem TOLERANTE a falha de conexão — o PgBouncer da VM derruba conexão
 *  ociosa, e uma exceção aqui mataria a noite inteira (foi o que aconteceu na
 *  primeira noite do harvest, às 23:41, com ~7h de máquina ligada perdidas). */
async function medir(tentativas = 6) {
  let ultimoErro
  for (let t = 1; t <= tentativas; t++) {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    try {
      await db.connect()
      const { rows: [r] } = await db.query(`
        SELECT count(*) FILTER (WHERE portal_backfill_em IS NULL) portais_total,
               count(*) FILTER (WHERE portal_backfill_em IS NULL AND NOT EXISTS (
                 SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)) portais_abertas,
               count(usuario_nome) com_sistema,
               count(*) FILTER (WHERE valor_total_estimado IS NULL
                                  AND valor_original IS NULL
                                  AND data_publicacao >= '2025-01-01') sem_valor
          FROM contratacoes c`)
      return {
        portaisTotal: Number(r.portais_total),
        portaisAbertas: Number(r.portais_abertas),
        comSistema: Number(r.com_sistema),
        semValor: Number(r.sem_valor),
      }
    } catch (e) {
      ultimoErro = e
      log(`banco recusou (${e.code ?? e.message}) — tentativa ${t}/${tentativas}`)
      await sleep(Math.min(30000, 2000 * t))
    } finally {
      try { await db.end() } catch {}
    }
  }
  throw ultimoErro
}

/** Igual ao medir(), mas nunca lança: devolve null e o chamador espera. */
async function medirOuEsperar() {
  try {
    return await medir()
  } catch (e) {
    log(`banco inacessível (${e?.code ?? e?.message}) — esperando 10min`)
    await sleep(10 * 60 * 1000)
    return null
  }
}

/** Uma requisição barata só para saber se vale começar uma rodada.
 *
 *  POR QUE ISTO EXISTE: o harvest e o enriquecedor sabem RECUPERAR de uma queda
 *  do PNCP, mas descobrem a queda trabalhando. Medido em 13/08/2026 das 09:37 às
 *  10:26: 10 pares consumidos a 5m20s cada (4 tentativas de 20s + 4 esperas de
 *  backoff no teto de 60s), todos em `pag=1/?`, ZERO registros resolvidos — e o
 *  circuit-breaker exige 10 falhas seguidas, então cada ciclo de outage custa
 *  ~53 min de máquina ligada por nada. A sonda chega à mesma conclusão em 20s.
 *
 *  204 conta como vivo: é a resposta legítima do PNCP para dia/modalidade sem
 *  nada publicado, e tratá-la como queda faria a sonda barrar o pipeline num dia
 *  vazio. */
async function pncpVivo() {
  const url = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao'
    + '?dataInicial=20260805&dataFinal=20260805&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=50'
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    return r.status === 200 || r.status === 204
  } catch {
    return false
  }
}

/** Espera o PNCP voltar antes de gastar uma rodada. Não desiste: quem decide
 *  parar é você, e a tarefa de logon religa depois de reboot. */
async function esperarPncp(rotulo) {
  let tentativa = 0
  while (!(await pncpVivo())) {
    tentativa++
    log(`${rotulo}: PNCP fora — sonda ${tentativa}, esperando ${ESPERA_RECUSA / 60000}min`)
    await sleep(ESPERA_RECUSA)
  }
  if (tentativa) log(`${rotulo}: PNCP respondeu depois de ${tentativa} sonda(s) — retomando`)
}

function rodar(script, args = []) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env })
    p.on('exit', (code) => resolve(code ?? 0))
  })
}

// ── FASE 1 e 3 — portais ────────────────────────────────────────────────────
// O harvest-portais.mjs encerra DE PROPÓSITO quando o PNCP entra em recusa
// sustentada, com o cursor salvo. Cabe aqui rechamar até a fila zerar.
async function colherPortais(soAbertas) {
  const alvo = soAbertas ? 'portaisAbertas' : 'portaisTotal'
  const rotulo = soAbertas ? 'FASE 1 · portais das abertas' : 'FASE 3 · portais do histórico'
  let rodadas = 0

  for (;;) {
    const antes = await medirOuEsperar()
    if (!antes) continue

    if (antes[alvo] === 0) {
      log(`${rotulo}: ZERADA — ${antes.comSistema} contratações com portal identificado.`)
      return
    }

    await esperarPncp(rotulo)

    rodadas++
    log(`${rotulo}: rodada ${rodadas} — ${antes[alvo]} pendentes`)
    await rodar('./scripts/harvest-portais.mjs', soAbertas ? ['--abertas'] : [])

    const depois = (await medirOuEsperar()) ?? antes
    const avanco = antes.portaisTotal - depois.portaisTotal
    // Rodada que não andou = PNCP recusando. Insistir em seguida só queima limite.
    const espera = avanco > 0 ? ESPERA_NORMAL : ESPERA_RECUSA
    log(`${rotulo}: rodada ${rodadas} +${avanco} resolvidos | restam ${depois[alvo]} | esperando ${espera / 60000}min`)
    await sleep(espera)
  }
}

// ── FASE 2 — valores ────────────────────────────────────────────────────────
// Depois de cada passada, neutraliza: a varredura preenche valor NULL com o que
// o PNCP devolve, e o PNCP continua devolvendo erro de digitação (a passada 3 de
// 12/08 trouxe 4 novos absurdos). O teto de R$ 10 bi é idempotente — define o
// estado final, não acumula execuções.
async function enriquecerValores() {
  for (let passada = 1; passada <= PASSADAS_VALOR; passada++) {
    for (const j of JANELAS) {
      await esperarPncp('FASE 2 · valores')
      const antes = await medirOuEsperar()
      log(`FASE 2 · valores: passada ${passada} ${j.de} -> ${j.ate}`
        + `${antes ? ` | ${antes.semValor} sem valor desde jan/2025` : ''}`)
      await rodar('./scripts/etl-enriquecer.mjs', [`--de=${j.de}`, `--ate=${j.ate}`, '--pausa=300'])
    }
    log(`FASE 2 · valores: neutralizando absurdos (passada ${passada})`)
    await rodar('./scripts/limpar-ruido.mjs', ['--so-valor', '--teto=1e10', '--aplicar'])
  }
  const fim = await medirOuEsperar()
  log(`FASE 2 · valores: concluída${fim ? ` — ${fim.semValor} ainda sem valor desde jan/2025` : ''}`)
}

// ── Execução ────────────────────────────────────────────────────────────────
const inicio = await medirOuEsperar()
log('iniciando — fase 1 portais (abertas), fase 2 valores, fase 3 portais (histórico).')
if (inicio) {
  log(`estado: ${inicio.portaisAbertas} abertas sem portal | ${inicio.portaisTotal} no total | `
    + `${inicio.comSistema} com portal | ${inicio.semValor} sem valor desde jan/2025`)
}

await colherPortais(true)
await enriquecerValores()
await colherPortais(false)

log('FIM — as três fases terminaram.')
