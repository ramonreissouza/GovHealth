// scripts/radar/banco-resiliente.teste.mjs — o retry que impede a conexão caída de
// apagar a fila, e que NÃO pode esconder erro de verdade.
//
// Sem banco e sem relógio: a consulta é uma função que falha do jeito que pedimos, e a
// espera é registrada em vez de dormida.

import { comRetry, erroTransitorio } from './banco-resiliente.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const erro = (message, code) => Object.assign(new Error(message), code ? { code } : {})
const RESET = () => erro('read ECONNRESET', 'ECONNRESET')
// O que o pg lança quando o PgBouncer derruba a conexão no meio (visto no radar.log).
const TERMINADA = () => erro('Connection terminated unexpectedly')

/** Consulta falsa: falha com os erros da fila, depois responde. */
function consultaQueFalha(...erros) {
  const est = { chamadas: 0 }
  const fn = async () => {
    est.chamadas++
    const e = erros.shift()
    if (e) throw e()
    return { rows: [{ ok: true }] }
  }
  return { fn, est }
}

const esperas = []
const dormir = async (ms) => { esperas.push(ms) }

console.log('\nbanco-resiliente — o que é transitório\n')

afirmar('ECONNRESET é transitório', erroTransitorio(RESET()), true)
afirmar('"Connection terminated unexpectedly" é transitório', erroTransitorio(TERMINADA()), true)
afirmar('57P01 (PgBouncer reiniciando) é transitório', erroTransitorio(erro('terminating connection due to administrator command', '57P01')), true)
afirmar('08006 é transitório', erroTransitorio(erro('x', '08006')), true)
// Repetir estes não conserta nada — só atrasa e esconde o defeito.
afirmar('tabela inexistente NÃO é transitório', erroTransitorio(erro('relation "x" does not exist', '42P01')), false)
afirmar('violação de unicidade NÃO é transitório', erroTransitorio(erro('duplicate key value', '23505')), false)
afirmar('ON CONFLICT sem índice (42P10) NÃO é transitório', erroTransitorio(erro('there is no unique or exclusion constraint', '42P10')), false)
afirmar('null não é transitório', erroTransitorio(null), false)

console.log('\nbanco-resiliente — comRetry\n')

{
  const { fn, est } = consultaQueFalha(RESET)
  const r = await comRetry(fn, { dormir })
  afirmar('conexão caiu uma vez: a 2ª tentativa responde', r.rows[0].ok, true)
  afirmar('conexão caiu uma vez: 2 chamadas', est.chamadas, 2)
}

{
  esperas.length = 0
  const { fn, est } = consultaQueFalha(TERMINADA, RESET)
  const r = await comRetry(fn, { dormir })
  afirmar('caiu duas vezes: a 3ª responde', r.rows[0].ok, true)
  afirmar('caiu duas vezes: 3 chamadas', est.chamadas, 3)
  afirmar('espera cresce entre as tentativas', esperas, [500, 2000])
}

{
  const { fn, est } = consultaQueFalha(RESET, RESET, RESET, RESET)
  let capturado = null
  try { await comRetry(fn, { dormir }) } catch (e) { capturado = e }
  afirmar('banco fora do ar: desiste depois de 3', est.chamadas, 3)
  afirmar('banco fora do ar: o erro sobe (quem decide é o isolamento do run.mjs)', capturado?.code, 'ECONNRESET')
}

{
  const { fn, est } = consultaQueFalha(() => erro('relation "radar_x" does not exist', '42P01'))
  let capturado = null
  try { await comRetry(fn, { dormir }) } catch (e) { capturado = e }
  afirmar('erro de SQL: não repete', est.chamadas, 1)
  afirmar('erro de SQL: sobe intacto', capturado?.code, '42P01')
}

{
  const avisos = []
  const { fn } = consultaQueFalha(RESET)
  await comRetry(fn, { dormir, aoRepetir: (e, n) => avisos.push([e.code, n]) })
  afirmar('a repetição é avisada, não silenciosa', avisos, [['ECONNRESET', 1]])
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
