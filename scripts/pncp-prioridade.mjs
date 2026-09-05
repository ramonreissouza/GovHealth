// scripts/pncp-prioridade.mjs — quem passa na frente na pista do PNCP.
//
// POR QUE ISSO EXISTE (medido em 05/09/2026).
//
// O `pncp-lock` garante um dono só, e isso resolveu a degradação por concorrência.
// Mas ele é primeiro-a-chegar, e o resultado prático foi o pior arranjo possível:
//
//   01:00 de 05/09 — o sync-cobertura acorda, descobre que 04/09 e 03/09 precisam
//   ser recolhidos, e desiste: `pista ocupada por "etl-enriquecer"`.
//
// O sync-cobertura é a GUARDA DA RECÊNCIA: ele pergunta ao banco quais dias estão
// magros e recolhe. Roda em minutos. E estava perdendo a vez para o backfill de itens,
// cuja própria estimativa em 04/09 era de ~492h — vinte dias seguidos. Um trabalho
// infinito e adiável bloqueando um trabalho curto e urgente, todo dia, em silêncio.
//
// Ordenar a fila não basta: de que adianta ser o primeiro da fila se o dono da vez
// vai segurar a pista por doze horas? Por isso aqui tem DUAS coisas — prioridade na
// fila e PASSAGEM: quem está com a pista pergunta, de tempos em tempos, se alguém
// mais urgente chegou, e cede.
//
// ARQUIVO SEPARADO DE PROPÓSITO. O `.pncp-ocupado` é reescrito inteiro pela batida do
// dono a cada 5 min; qualquer campo que eu somasse lá seria apagado pelo próprio dono
// — inclusive por um processo que já esteja rodando com a versão anterior do módulo.
// A fila mora em `.pncp-fila/<pid>.json`, que ninguém reescreve por cima.
//
// MESMA DISCIPLINA DO LOCK: pedido só vale enquanto se prova vivo. Um pedido órfão
// (processo morto sem faxina) faria o dono ceder a pista para um fantasma, para sempre
// — que é a mesma classe de parada invisível que o `pncp-lock` já pagou caro para
// aprender. Por isso `fila()` confere o PID e apaga o que não se sustenta.

import fs from 'node:fs'
import path from 'node:path'
import { estado, pegar, soltar } from './pncp-lock.mjs'

const PASTA = path.join(process.cwd(), '.pncp-fila')

// Menor = mais urgente. A ordem é a resposta para "se os dois quiserem agora, quem
// atrasa menos o cliente?" — e não "quem é mais importante em abstrato".
export const PRIORIDADE = {
  // Guarda a recência. Roda em minutos e é o que o cliente vê na tela hoje.
  'sync-cobertura': 10,
  // Refresh CURTO (janela de dias, a cada 2 dias): é a promessa de "o cliente sempre vê
  // o que saiu esta semana". Passa na frente do refresh longo de propósito — nos dias em
  // que os dois caem juntos, esperar 16h pelo longo mataria justamente o frescor. O
  // longo retoma do checkpoint depois; atrasar profundidade custa menos que atrasar hoje.
  'etl-refresh-2dias': 15,
  // Refresh LONGO (janela de 21 dias): rede profunda para o que o PNCP publica com
  // atraso. É o alimento principal da base, mas nada nele é de hoje.
  'etl-refresh-loop': 20,
  // Terceira passada do dia: o que a paginação não alcançou.
  'etl-residuo': 30,
  // Preenche campos de linhas que já existem. Adiável sem o cliente notar.
  'etl-enriquecer': 40,
  // Mutirões de período antigo: valiosos, mas nada neles é de hoje.
  'backfill-2025h1': 50,
  'backfill-antigos': 50,
  // Fundo do poço por mérito próprio: ~492h de estimativa, cresce enquanto roda.
  'backfill-itens': 60,
}
const PADRAO = 50
export const prioridadeDe = (dono) => PRIORIDADE[dono] ?? PADRAO

// QUANDO QUEM VARRE NÃO É QUEM TEM A PISTA. O etl-refresh-loop e os mutirões seguram
// o lock no processo PAI e mandam um `etl-pncp` filho varrer. O pai não consegue
// interromper o filho no meio de uma fatia, e a fatia dura horas — então quem cede é
// o filho: ele sai com este código num limite de página (onde o checkpoint acabou de
// ser gravado), e o pai entende que foi passagem, não falha, cede a pista e reexecuta
// a MESMA fatia depois. Como o checkpoint retoma da página seguinte, nada se repete.
//
// 75 é EX_TEMPFAIL do sysexits.h: "falha temporária, tente de novo". É exatamente o
// que aconteceu, e não colide com o 0 (sucesso) nem com o 1 (erro de verdade).
export const CODIGO_CEDER = 75

// Os três tempos saem do ambiente para o teste conseguir exercitar em milissegundos
// o que em produção leva minutos — e, de quebra, dá para afinar sem editar código.
const ms = (env, padrao) => Number(process.env[env]) || padrao
// Quem está na fila reconfere rápido: a passagem só vale a pena se o sucessor assume
// em segundos. Poll de 10 min (o que os consumidores faziam) transformaria cada
// cessão em dez minutos de pista vazia.
const POLL_MS = ms('PNCP_FILA_POLL_MS', 20 * 1000)
// Depois de ceder, o dono anterior não tenta retomar antes disso — dá tempo de o
// sucessor pegar. Sem isso os dois disputam e o mais rápido vence sempre o mesmo.
const GRACA_MS = ms('PNCP_FILA_GRACA_MS', 45 * 1000)
// E não cede de novo antes de trabalhar isto. Sem essa trava, um consumidor urgente
// que acorda de minuto em minuto deixaria o longo cedendo para sempre sem produzir
// nada — fila justa que entrega zero.
const MIN_TRABALHO_MS = ms('PNCP_FILA_MIN_TRABALHO_MS', 10 * 60 * 1000)
// A conferência é memorizada por este tanto porque roda dentro de laço de página.
const MEMO_MS = ms('PNCP_FILA_MEMO_MS', 15 * 1000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' }
}

const meuPedido = () => path.join(PASTA, `${process.pid}.json`)

/** Anuncia que quero a pista. Idempotente: chamar de novo só renova o carimbo. */
export function entrarNaFila(dono, prioridade = prioridadeDe(dono)) {
  try {
    fs.mkdirSync(PASTA, { recursive: true })
    fs.writeFileSync(meuPedido(), JSON.stringify({
      pid: process.pid, dono, prioridade, desde: new Date().toISOString(),
    }))
  } catch { /* fila é otimização, não correção: sem ela tudo ainda funciona */ }
}

export function sairDaFila() {
  try { fs.unlinkSync(meuPedido()) } catch { /* já não existe */ }
}

/** Pedidos vivos, mais urgente primeiro. Apaga os órfãos que encontrar. */
export function fila() {
  let nomes = []
  try { nomes = fs.readdirSync(PASTA) } catch { return [] }
  const vivos = []
  for (const n of nomes) {
    if (!n.endsWith('.json')) continue
    const alvo = path.join(PASTA, n)
    let p
    try { p = JSON.parse(fs.readFileSync(alvo, 'utf8')) } catch { p = null }
    if (!p || !pidVivo(p.pid)) {
      try { fs.unlinkSync(alvo) } catch { /* corrida com outro faxineiro: tudo bem */ }
      continue
    }
    vivos.push(p)
  }
  return vivos.sort((a, b) => (a.prioridade ?? PADRAO) - (b.prioridade ?? PADRAO))
}

let ultimaConferida = 0
let ultimaResposta = null
let trabalhandoDesde = Date.now()

/** Chamado DENTRO do laço de quem tem a pista. Barato: relê no máximo a cada 15s.
 *  `dono` é quem eu sou; devolve o pedido que me passa na frente, ou null. */
export function quemPedePassagem(dono) {
  const agora = Date.now()
  if (agora - trabalhandoDesde < MIN_TRABALHO_MS) return null
  if (agora - ultimaConferida < MEMO_MS) return ultimaResposta
  ultimaConferida = agora
  const minha = prioridadeDe(dono)
  ultimaResposta = fila().find((p) => p.pid !== process.pid && (p.prioridade ?? PADRAO) < minha) ?? null
  return ultimaResposta
}

export const devoCeder = (dono) => quemPedePassagem(dono) !== null

/** Só para o teste: zera a memória de "estou trabalhando há pouco" e o memo de 15s. */
export function _zerarCache({ trabalhandoHa = MIN_TRABALHO_MS + 1 } = {}) {
  trabalhandoDesde = Date.now() - trabalhandoHa
  ultimaConferida = 0
  ultimaResposta = null
}

/** Solta a pista, deixa o sucessor entrar e retoma. Só volta quando eu tenho a pista
 *  de novo — para quem chama, é uma pausa, não uma desistência. */
export async function ceder(dono, { log = console.log, tetoMin = 120 } = {}) {
  const quem = quemPedePassagem(dono)
  log(`cedendo a pista para "${quem?.dono ?? 'alguém mais urgente'}" — retomo depois`)
  soltar()
  ultimaConferida = 0
  ultimaResposta = null

  // Espera alguém assumir (ou a graça acabar, se ninguém veio de fato).
  const ateGraca = Date.now() + GRACA_MS
  while (Date.now() < ateGraca && !estado().ocupado) await sleep(2000)

  // Agora espera a pista desocupar de novo, como qualquer um na fila.
  entrarNaFila(dono)
  const teto = Date.now() + tetoMin * 60 * 1000
  while (estado().ocupado && Date.now() < teto) await sleep(POLL_MS)
  sairDaFila()

  pegar(dono)
  trabalhandoDesde = Date.now()
  log('pista retomada.')
}

/** O laço de espera que cada consumidor reescrevia à mão, agora com fila.
 *  Devolve true se peguei a pista; false se desisti no teto. */
export async function esperarVez(dono, { esperaMaxMin = 0, log = console.log } = {}) {
  const inicio = Date.now()
  entrarNaFila(dono)
  let avisos = 0
  try {
    while (estado().ocupado) {
      if (esperaMaxMin && (Date.now() - inicio) / 60000 >= esperaMaxMin) {
        log(`pista ainda ocupada por "${estado().dono}" — desisto desta rodada`)
        return false
      }
      // Um aviso por minuto no máximo: o poll é de 20s para a passagem ser rápida,
      // mas encher o log de 3 linhas por minuto não ajuda ninguém a depurar.
      if (Date.now() - inicio > avisos * 60000) {
        const à_frente = fila().filter((p) => p.pid !== process.pid && (p.prioridade ?? PADRAO) < prioridadeDe(dono)).length
        log(`pista ocupada por "${estado().dono}"${à_frente ? ` · ${à_frente} na minha frente` : ''} — espera ${++avisos}`)
      }
      await sleep(POLL_MS)
    }
    pegar(dono)
    trabalhandoDesde = Date.now()
    return true
  } finally {
    sairDaFila()
  }
}

/** Para quem sai por conta própria: tira o pedido da fila junto com o lock. */
export function limparNaSaida() {
  process.on('exit', sairDaFila)
}
