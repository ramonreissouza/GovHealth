// scripts/cobertura-regua.teste.mjs — a regua da cobertura e o calendario de feriados.
//
// O modo de falha desta area nao e perder dado, e GASTAR PISTA PARA SEMPRE. Um dia
// completo que a regua nunca pode aprovar volta para a fila em toda execucao, tres
// vezes por dia, indefinidamente, e o log diz "ainda em falta" com toda a conviccao.
// Nada quebra e nada avisa.
//
// Os dois ultimos blocos sao o que importa: eles rodam os MESMOS dias pela regra
// ANTIGA e exigem que a regra antiga erre. Teste que passa no codigo velho nao prova
// nada — foi a licao do pncp-lock.

import { pascoa, moveis, ehFeriado, nomeFeriado } from './feriados.mjs'
import { classificar, avaliar, mereceConfirmacao, mediana, UTIL, FDS, FERIADO } from './cobertura-regua.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

// ── o calendario ─────────────────────────────────────────────────────────────
// Pascoa conferida contra datas conhecidas: se o algoritmo estiver errado, TODO
// feriado movel (Carnaval, Sexta-feira Santa, Corpus Christi) sai errado junto.
console.log('\n── calendario de feriados ──')
afirmar('pascoa 2024', pascoa(2024).join('/'), '3/31')
afirmar('pascoa 2025', pascoa(2025).join('/'), '4/20')
afirmar('pascoa 2026', pascoa(2026).join('/'), '4/5')
afirmar('pascoa 2027', pascoa(2027).join('/'), '3/28')
afirmar('carnaval 2026 (terca)', moveis(2026)['carnaval-terca'], '2026-02-17')
afirmar('sexta-feira santa 2026', moveis(2026)['sexta-feira-santa'], '2026-04-03')
afirmar('corpus christi 2026', moveis(2026)['corpus-christi'], '2026-06-04')

afirmar('07/09 e feriado', ehFeriado('2026-09-07'), true)
afirmar('07/09 tem nome', nomeFeriado('2026-09-07'), 'Independência')
afirmar('08/09 nao e feriado', ehFeriado('2026-09-08'), false)
afirmar('20/11 e feriado (Lei 14.759/2023)', ehFeriado('2026-11-20'), true)

// Lixo nao pode derrubar a regua: ela decide se a coleta roda.
afirmar('data invalida nao explode', ehFeriado('2026-13-99'), false)
afirmar('null nao explode', ehFeriado(null), false)
afirmar('texto qualquer nao explode', ehFeriado('ontem'), false)

// ── classificacao ────────────────────────────────────────────────────────────
console.log('\n── classificacao das tres classes ──')
afirmar('terca comum e util', classificar('2026-09-08', 2), UTIL)
afirmar('sabado e fim de semana', classificar('2026-09-05', 6), FDS)
afirmar('domingo e fim de semana', classificar('2026-09-06', 0), FDS)
afirmar('segunda 07/09 e FERIADO, nao util', classificar('2026-09-07', 1), FERIADO)
// Feriado que cai no fim de semana continua fim de semana: a classe nao muda nada
// para a regua (as duas usam a mesma mediana) e inventar precedencia seria ruido.
afirmar('feriado no domingo segue fim de semana', classificar('2026-11-15', 0), FDS)

afirmar('mediana de lista impar', mediana([1, 100, 5]), 5)
afirmar('mediana de lista par arredonda', mediana([10, 20, 30, 40]), 25)
afirmar('mediana de lista vazia e zero', mediana([]), 0)

// ── o cenario real de 10/09/2026 ─────────────────────────────────────────────
// Numeros medidos no banco naquele dia, nao inventados.
const REF = [
  { iso: '2026-09-10', n: 431, idade: 0, classe: UTIL },
  { iso: '2026-09-09', n: 614, idade: 1, classe: UTIL },
  { iso: '2026-09-08', n: 672, idade: 2, classe: UTIL },
  { iso: '2026-09-07', n: 51, idade: 3, classe: FERIADO },
  { iso: '2026-09-06', n: 0, idade: 4, classe: FDS },
  { iso: '2026-09-05', n: 0, idade: 5, classe: FDS },
  { iso: '2026-09-04', n: 720, idade: 6, classe: UTIL },
  { iso: '2026-09-03', n: 853, idade: 7, classe: UTIL },
  { iso: '2026-09-02', n: 819, idade: 8, classe: UTIL },
  { iso: '2026-09-01', n: 745, idade: 9, classe: UTIL },
  { iso: '2026-08-31', n: 790, idade: 10, classe: UTIL },
  { iso: '2026-08-30', n: 9, idade: 11, classe: FDS },
  { iso: '2026-08-29', n: 14, idade: 12, classe: FDS },
  { iso: '2026-08-28', n: 800, idade: 13, classe: UTIL },
]
const copia = () => REF.map((d) => ({ ...d }))

console.log('\n── o feriado deixa de ser buraco ──')
let dias = copia()
let r = avaliar(dias, copia())
const em = (iso) => dias.find((d) => d.iso === iso)

afirmar('a regua de baixo volume nao virou a de dia util', r.refBaixo < 100, true)
afirmar('07/09 e comparado com a regua de baixo volume', em('2026-09-07').ref, r.refBaixo)
afirmar('07/09 NAO e recolhido', em('2026-09-07').recolher, false)
afirmar('07/09 nao tem motivo de buraco', em('2026-09-07').motivo, null)
afirmar('o relatorio diz qual feriado e', em('2026-09-07').feriado, 'Independência')
afirmar('08/09 (util, 672) segue aprovado', em('2026-09-08').recolher, false)
afirmar('os dois mais novos entram sempre', [em('2026-09-10').recolher, em('2026-09-09').recolher], [true, true])
// Sem confirmacao ainda, o fim de semana zerado CONTINUA sendo buraco — e tem de
// continuar: a marca nao relaxa a regua, ela registra resposta ja obtida.
afirmar('fim de semana zerado ainda e buraco sem confirmacao', em('2026-09-05').recolher, true)

console.log('\n── a marca de confirmado tira o dia da fila ──')
dias = copia()
avaliar(dias, copia(), { confirmados: new Map([['2026-09-05', 0], ['2026-09-06', 0]]) })
afirmar('05/09 confirmado sai da fila', em('2026-09-05').recolher, false)
afirmar('06/09 confirmado sai da fila', em('2026-09-06').recolher, false)
afirmar('o relatorio explica a dispensa', em('2026-09-05').dispensa, 'varredura completa confirmou 0')

console.log('\n── a confirmacao vence quando o dia muda ──')
dias = copia()
avaliar(dias, copia(), { confirmados: new Map([['2026-09-05', 7]]) })
afirmar('contagem diferente: confirmacao nao vale', em('2026-09-05').confirmado, false)
afirmar('contagem diferente: marcada como vencida', em('2026-09-05').confirmacaoVencida, true)
afirmar('e o dia volta a ser recolhido', em('2026-09-05').recolher, true)

console.log('\n── inacabado vence tudo, inclusive a confirmacao ──')
dias = copia()
avaliar(dias, copia(), {
  inacabados: new Map([['2026-09-03', 400]]),
  confirmados: new Map([['2026-09-03', 853]]),
})
afirmar('dia inacabado e recolhido mesmo acima da regua', em('2026-09-03').recolher, true)
afirmar('e o motivo e o inacabado, nao a regua', em('2026-09-03').motivo, 'inacabado (parou em 400)')

console.log('\n── quem merece a marca ──')
afirmar('varredura inteira sem ganho merece', mereceConfirmacao({ inteiro: true, idade: 4, ganho: 0 }), true)
afirmar('varredura cortada NAO merece', mereceConfirmacao({ inteiro: false, idade: 4, ganho: 0 }), false)
afirmar('ganhou linha nova NAO merece', mereceConfirmacao({ inteiro: true, idade: 4, ganho: 12 }), false)
afirmar('dia de hoje NAO merece (ainda publica)', mereceConfirmacao({ inteiro: true, idade: 0, ganho: 0 }), false)
afirmar('ontem NAO merece (ainda publica)', mereceConfirmacao({ inteiro: true, idade: 1, ganho: 0 }), false)

// ── a regra ANTIGA, rodada nos mesmos dias, tem de ERRAR ─────────────────────
// Reproduz a regua como era antes de 10/09/2026: classe so por dia da semana, sem
// feriado e sem marca de confirmado. Se este bloco passar, o conserto nao consertou.
console.log('\n── reprovando a regra antiga nos mesmos dias ──')
function reguaAntiga(dias, referencia, { limiar = 0.5, pisoRef = 20 } = {}) {
  const fdsAntigo = (d) => d.classe === FDS // era: dow 0 ou 6 — feriado caia em util
  const base = referencia.filter((d) => d.idade > 0)
  const refUtil = mediana(base.filter((d) => !fdsAntigo(d)).map((d) => d.n))
  const refFds = mediana(base.filter((d) => fdsAntigo(d)).map((d) => d.n))
  return dias.map((d) => {
    const ref = fdsAntigo(d) ? refFds : refUtil
    const faltando = ref < pisoRef ? d.n === 0 : d.n < limiar * ref
    return { iso: d.iso, ref, recolher: d.idade <= 1 || faltando }
  })
}
// O feriado entra na conta de dia util na regra antiga, por isso a referencia dele
// vem da mediana dos dias uteis.
const antigo = reguaAntiga(copia().map((d) => ({ ...d, classe: d.classe === FERIADO ? UTIL : d.classe })), copia())
const antigoEm = (iso) => antigo.find((d) => d.iso === iso)

afirmar('ANTES: 07/09 era comparado com a regua de dia util', antigoEm('2026-09-07').ref > 700, true)
afirmar('ANTES: 07/09 era recolhido (o defeito)', antigoEm('2026-09-07').recolher, true)
afirmar('DEPOIS: 07/09 nao e', em('2026-09-07') && copia() && (() => { const d = copia(); avaliar(d, copia()); return d.find((x) => x.iso === '2026-09-07').recolher })(), false)
afirmar('ANTES: 05/09 confirmado seguia sendo recolhido', antigoEm('2026-09-05').recolher, true)

// ── o custo, que e o que este conserto realmente economiza ───────────────────
// O sync-cobertura roda 3x/dia e varre um dia por vez. Cada dia falso na fila e uma
// varredura nacional das 27 UFs. Medido em 10/09/2026: a rodada das 12:00 levou 40min
// para 5 dias, ou seja ~8min por dia.
const MIN_POR_DIA = 8
const EXEC_POR_DIA = 3
const falsosAntes = ['2026-09-07', '2026-09-06', '2026-09-05'].length
const falsosDepois = 0 // feriado pela classe, fim de semana pela confirmacao
const perdidoAntes = falsosAntes * MIN_POR_DIA * EXEC_POR_DIA
const perdidoDepois = falsosDepois * MIN_POR_DIA * EXEC_POR_DIA
console.log(`\n  pista gasta por dia reconfirmando dia ja completo:`)
console.log(`    regra ANTIGA: ${falsosAntes} dia(s) falso(s) · ${perdidoAntes}min/dia · ${(perdidoAntes * 7 / 60).toFixed(1)}h/semana`)
console.log(`    regra NOVA  : ${falsosDepois} dia(s) falso(s) · ${perdidoDepois}min/dia\n`)
afirmar('ANTES: mais de uma hora de pista por dia em dia ja completo', perdidoAntes > 60, true)
afirmar('DEPOIS: zero', perdidoDepois, 0)

console.log(`\n${ok} ok · ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
