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
//   node scripts/pipeline-noite.mjs                 # ordem 1,2,3
//   node scripts/pipeline-noite.mjs --fases=2,1     # valores primeiro, portais depois
//   npm run pipeline:noite
//
// A ORDEM É ARGUMENTO porque a fase de portais tem cauda longa: medido em
// 20/08/2026, os 20 primeiros pares (dia × modalidade) casaram 1.088 registros, os
// pares 20-30 casaram 409 e os pares 30-40 casaram 21 — a fila caiu de 4.352 para
// 2.834 em 1h30 e depois passou a resolver ~35 por hora. Ficar 19h moendo cauda
// enquanto 37 mil contratações seguem sem valor na tela é a prioridade errada, e
// trocar isso não deveria exigir editar o script.
//
// Ctrl+C é seguro em qualquer ponto: o harvest guarda o cursor por par
// (dia, modalidade) e o enriquecedor guarda checkpoint por (mês, modalidade).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import pg from 'pg'
import { estado as estadoLockPncp } from './pncp-lock.mjs'

const ESPERA_RECUSA = 15 * 60 * 1000   // PNCP recusando: espera longa
const ESPERA_NORMAL = 60 * 1000        // rodada produtiva que parou por outro motivo
const PASSADAS_VALOR = 3               // passadas do enriquecedor por janela
const RODADAS_SEM_AVANCO = 3           // portais: desiste da fase depois disto

const arg = (nome) => {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${nome}=`))
  return m ? m.split('=').slice(1).join('=') : undefined
}

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
 *  vazio.
 *
 *  TRÊS TENTATIVAS, não uma. Medido em 20/08/2026 às 12:15, três requisições
 *  idênticas em sequência: timeout de 40s, HTTP 500 em 31s, e HTTP 200 em 1,3s.
 *  O PNCP não cai — ele pisca. Com sonda de tiro único, dois terços das vezes o
 *  veredito é "fora" e cada falso negativo custa 15 minutos de máquina parada
 *  enquanto o servidor atende. Três tentativas custam no pior caso ~1min. */
async function pncpVivo(tentativas = 3) {
  const url = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao'
    + '?dataInicial=20260805&dataFinal=20260805&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=50'
  for (let t = 1; t <= tentativas; t++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (r.status === 200 || r.status === 204) return true
    } catch { /* timeout/rede: conta como tentativa perdida, não como veredito */ }
    if (t < tentativas) await sleep(5000)
  }
  return false
}

/** O refresh (etl-refresh-loop.mjs) marca a pista como ocupada, e aqui a gente
 *  respeita. Disputar o PNCP com ele não acelera nada: em 21/08/2026 os dois juntos
 *  renderam 18× HTTP 429 e 14× 503; em 22/08, um de cada vez, foram 4 quedas em 485
 *  páginas. É o mesmo "UM DONO SÓ" do topo deste arquivo — só que agora o outro
 *  dono é outro processo. Quem decide se o lock ainda vale (PID vivo + idade) é o
 *  pncp-lock.mjs: lock órfão não segura ninguém, senão a espera fica eterna. */
function refreshOcupado() {
  const e = estadoLockPncp()
  if (e.motivo) log(`lock do PNCP: ${e.motivo}`)
  return e.ocupado
}

/** Espera a vez antes de gastar uma rodada: ou o PNCP está fora, ou o refresh está
 *  com a pista. Não desiste: quem decide parar é você, e a tarefa de logon religa
 *  depois de reboot. */
async function esperarPncp(rotulo) {
  let tentativa = 0
  // Ordem importa: se o refresh está com a pista, nem sondamos o PNCP — a sonda são
  // 3 requisições que só somariam à disputa que estamos justamente evitando.
  while (refreshOcupado() || !(await pncpVivo())) {
    tentativa++
    const motivo = refreshOcupado() ? 'refresh varrendo as UFs' : 'PNCP fora'
    log(`${rotulo}: ${motivo} — sonda ${tentativa}, esperando ${ESPERA_RECUSA / 60000}min`)
    await sleep(ESPERA_RECUSA)
  }
  if (tentativa) log(`${rotulo}: pista liberada depois de ${tentativa} sonda(s) — retomando`)
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
  // A fila PODE NÃO ZERAR: parte dos pendentes simplesmente não aparece nas páginas
  // de /publicacao dos pares (dia, modalidade) que o harvest varre — número de
  // controle antigo, dia fora da janela, modalidade que mudou. Sem esta desistência
  // a fase gira para sempre em rodadas de zero e o pipeline nunca chega nas
  // seguintes. A sonda antes de cada rodada é o que torna a regra honesta: se o PNCP
  // estivesse fora, esperaríamos DENTRO de esperarPncp e a rodada nem começaria —
  // então rodada que rodou e não resolveu nada é evidência de fila irresolvível
  // nesta passada, não de servidor fora.
  let semAvanco = 0

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

    semAvanco = avanco > 0 ? 0 : semAvanco + 1
    if (semAvanco >= RODADAS_SEM_AVANCO) {
      log(`${rotulo}: ${semAvanco} rodadas seguidas sem resolver nada — desistindo da fase `
        + `com ${depois[alvo]} pendentes. O que sobrou é trabalho do refresh (ETL Refresh).`)
      return
    }
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
const FASES = {
  '1': { nome: 'portais das abertas', rodar: () => colherPortais(true) },
  '2': { nome: 'valores 2025/2026', rodar: () => enriquecerValores() },
  '3': { nome: 'portais do histórico', rodar: () => colherPortais(false) },
}
const ordem = (arg('fases') ?? '1,2,3').split(',').map((s) => s.trim()).filter(Boolean)
const invalidas = ordem.filter((n) => !FASES[n])
if (invalidas.length) {
  console.error(`[pipeline] fase desconhecida: ${invalidas.join(', ')} (use 1, 2 e/ou 3)`)
  process.exit(2)
}

const inicio = await medirOuEsperar()
log(`iniciando — ordem ${ordem.join(' → ')}: ${ordem.map((n) => `${n}) ${FASES[n].nome}`).join(', ')}.`)
if (inicio) {
  log(`estado: ${inicio.portaisAbertas} abertas sem portal | ${inicio.portaisTotal} no total | `
    + `${inicio.comSistema} com portal | ${inicio.semValor} sem valor desde jan/2025`)
}

for (const n of ordem) await FASES[n].rodar()

log(`FIM — fases ${ordem.join(',')} terminaram.`)
