// scripts/pncp-lock.mjs — quem está com a pista do PNCP.
//
// O PNCP degrada com concorrência: em 21/08/2026 o refresh e o harvest juntos
// renderam 18× HTTP 429 e 14× 503; em 22/08, um de cada vez, foram 4 quedas em 485
// páginas. Serializar não é elegância, é o que faz a coleta andar.
//
// É um lock COOPERATIVO: ninguém é impedido de rodar, só avisado. O dano da
// concorrência é degradação, não corrupção, então travar de verdade custaria mais
// do que resolve.
//
// A REGRA CENTRAL DESTE ARQUIVO: um lock só vale enquanto se PROVA vivo. Lock que
// depende de faxina na saída é lock que um dia fica órfão — o Scheduler mata a
// tarefa no ExecutionTimeLimit, a máquina reinicia, o processo leva SIGKILL, e o
// handler de saída simplesmente não roda. E o modo de falha de um lock órfão é o
// pior possível: o pipeline espera para sempre por um refresh que já morreu,
// silenciosamente, que é exatamente o tipo de parada invisível que este projeto já
// pagou caro para descobrir. Por isso `ocupado()` confere o PID e a idade, e ignora
// (apagando) o que não se sustenta.

import fs from 'node:fs'
import path from 'node:path'

const ARQUIVO = path.join(process.cwd(), '.pncp-ocupado')

// POR QUE O TETO DE IDADE VIROU TETO DE SILÊNCIO
// A versão anterior expirava o lock por IDADE, e conferia a idade ANTES da vida do
// PID. Consequência medida em 26/08/2026: o backfill de itens roda com orçamento de
// 30h, então na hora 20 ele perdia a pista ESTANDO VIVO — e o próximo processo a
// perguntar entrava por cima dele. Ou seja, o módulo que existe para garantir um dono
// só era quem criava o segundo dono, em toda rodada mais longa que 20h, em silêncio.
//
// Agora quem tem a pista se anuncia periodicamente (BATIDA_MS) e o teto mede o
// SILÊNCIO, não a idade. Um dono vivo nunca expira, por longa que seja a tarefa; um
// dono morto libera em meia hora em vez de vinte.
const BATIDA_MS = 5 * 60 * 1000
const SILENCIO_MS = 30 * 60 * 1000

// Locks escritos pela versão ANTIGA não se anunciam — não há batida para medir. Para
// eles sobra o teto de idade, agora largo o bastante para caber qualquer orçamento que
// usamos (30h) sem evitar de vez o caso que o teto existe para cobrir: PID reciclado
// pelo sistema, que faz um lock morto parecer vivo. Some quando nenhum processo da
// versão antiga estiver mais em curso.
const VALIDADE_LEGADO_MS = 48 * 60 * 60 * 1000

/** O processo ainda existe? `kill(pid, 0)` não envia sinal, só pergunta.
 *  EPERM = existe e não é nosso (conta como vivo); ESRCH = não existe. */
function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' }
}

let batida = null

/** Escreve o arquivo com a hora ATUAL — é a batida que prova o dono vivo. */
function anunciar(dono) {
  fs.writeFileSync(ARQUIVO, JSON.stringify({
    pid: process.pid, dono, desde: new Date().toISOString(), anuncia: true,
  }))
}

/** Marca a pista como ocupada. `dono` só serve para o log de quem espera.
 *  A batida é `unref`: ela não segura o processo vivo se o trabalho acabou. */
export function pegar(dono) {
  anunciar(dono)
  if (batida) clearInterval(batida)
  batida = setInterval(() => {
    // Se outro processo assumiu a pista no meio (não deveria, mas o lock é
    // cooperativo), não sobrescrevemos o dono dele: paramos de bater.
    try {
      const info = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))
      if (info.pid !== process.pid) { clearInterval(batida); batida = null; return }
    } catch { /* sumiu ou ilegível: reanunciar é o certo */ }
    try { anunciar(dono) } catch { /* disco ocupado: a próxima batida resolve */ }
  }, BATIDA_MS)
  batida.unref?.()
}

export function soltar() {
  if (batida) { clearInterval(batida); batida = null }
  try { fs.unlinkSync(ARQUIVO) } catch { /* já não existe: nada a fazer */ }
}

/** Registra a faxina em toda saída previsível. O `ocupado()` cobre as imprevisíveis. */
export function soltarNaSaida() {
  process.on('exit', soltar)
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sinal, () => { soltar(); process.exit(130) })
  }
}

/** { ocupado, dono } — e apaga lock que não se prova vivo. */
export function estado() {
  let cru
  try { cru = fs.readFileSync(ARQUIVO, 'utf8') } catch { return { ocupado: false } }

  let info
  try { info = JSON.parse(cru) } catch {
    // Ilegível é indefensável: não dá para conferir PID nem idade.
    soltar()
    return { ocupado: false, motivo: 'lock ilegível — descartado' }
  }

  // A VIDA VEM ANTES DA IDADE. Era o contrário, e era por isso que uma tarefa viva de
  // 30h perdia a pista na hora 20.
  if (!pidVivo(info.pid)) {
    soltar()
    return { ocupado: false, motivo: `lock órfão (PID ${info.pid} morreu) — descartado` }
  }

  const quietoMs = Date.now() - Date.parse(info.desde ?? 0)
  const teto = info.anuncia ? SILENCIO_MS : VALIDADE_LEGADO_MS
  // Só chega aqui lock cujo PID responde. Passar do teto aqui significa PID vivo que
  // não é mais o dono — reciclado pelo sistema — ou relógio andando para trás.
  if (!(quietoMs >= 0) || quietoMs > teto) {
    soltar()
    const q = info.anuncia ? `${Math.round(quietoMs / 60000)}min sem se anunciar`
                           : `${Math.round(quietoMs / 3600000)}h (lock da versão antiga)`
    return { ocupado: false, motivo: `lock com ${q} — descartado` }
  }
  return { ocupado: true, dono: info.dono ?? `PID ${info.pid}` }
}

export function ocupado() {
  return estado().ocupado
}
