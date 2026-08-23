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

// Teto de vida do lock. Mais largo que o ExecutionTimeLimit da tarefa (PT18H) para
// não expirar um refresh legítimo em curso, e curto o bastante para não segurar o
// pipeline por um dia inteiro se a checagem de PID falhar por algum motivo.
const VALIDADE_MS = 20 * 60 * 60 * 1000

/** O processo ainda existe? `kill(pid, 0)` não envia sinal, só pergunta.
 *  EPERM = existe e não é nosso (conta como vivo); ESRCH = não existe. */
function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' }
}

/** Marca a pista como ocupada. `dono` só serve para o log de quem espera. */
export function pegar(dono) {
  fs.writeFileSync(ARQUIVO, JSON.stringify({ pid: process.pid, dono, desde: new Date().toISOString() }))
}

export function soltar() {
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

  const idadeMs = Date.now() - Date.parse(info.desde ?? 0)
  if (!(idadeMs >= 0) || idadeMs > VALIDADE_MS) {
    soltar()
    return { ocupado: false, motivo: `lock com ${Math.round(idadeMs / 3600000)}h — expirado e descartado` }
  }
  if (!pidVivo(info.pid)) {
    soltar()
    return { ocupado: false, motivo: `lock órfão (PID ${info.pid} morreu) — descartado` }
  }
  return { ocupado: true, dono: info.dono ?? `PID ${info.pid}` }
}

export function ocupado() {
  return estado().ocupado
}
