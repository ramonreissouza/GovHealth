// scripts/pncp-breaker.teste.mjs — o disjuntor do enriquecimento.
//
// O modo de falha desta area e invisivel: com a API de itens fora, a rodada
// termina "com sucesso", cheia de contratacoes e sem um item, tendo gasto o
// orcamento inteiro dormindo em backoff. Nenhuma ponta recebe erro.
//
// O ultimo bloco e o que importa: ele mede o CUSTO com e sem disjuntor no mesmo
// cenario. Sem disjuntor o numero e absurdo — e era o que estava rodando.

process.env.PNCP_ENRIQ_LIMITE = '5'
process.env.PNCP_ENRIQ_ESPERA_MIN = '10'

const mod = await import('./pncp-breaker.mjs')

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const T0 = 1_000_000_000_000
const MIN = 60_000

// ── fechado por padrao ───────────────────────────────────────────────────────
mod.reiniciar()
afirmar('comeca fechado: pode enriquecer', mod.podeEnriquecer(T0), true)

// ── nao desliga antes do limite ──────────────────────────────────────────────
for (let i = 0; i < 4; i++) mod.registrarFalha(T0)
afirmar('4 falhas (limite 5) ainda deixam enriquecer', mod.podeEnriquecer(T0), true)
afirmar('a 5a falha DESLIGA e avisa uma unica vez', mod.registrarFalha(T0), true)
afirmar('desligado: nao enriquece', mod.podeEnriquecer(T0), false)
afirmar('falha depois de desligado nao reavisa', mod.registrarFalha(T0), false)

// ── a espera e respeitada ────────────────────────────────────────────────────
afirmar('9min depois ainda esta desligado', mod.podeEnriquecer(T0 + 9 * MIN), false)
afirmar('cumprida a espera, UMA chamada passa (meia-abertura)', mod.podeEnriquecer(T0 + 10 * MIN), true)

// ── sonda da meia-abertura falha: recomeca a espera, nao insiste ─────────────
mod.registrarFalha(T0 + 10 * MIN)
afirmar('sonda falhou: volta a esperar do zero', mod.podeEnriquecer(T0 + 11 * MIN), false)
afirmar('e so libera 10min depois DA SONDA', mod.podeEnriquecer(T0 + 20 * MIN), true)

// ── sonda da meia-abertura volta: religa ─────────────────────────────────────
afirmar('sucesso na meia-abertura RELIGA', mod.registrarSucesso(), true)
afirmar('religado: enriquece de novo', mod.podeEnriquecer(T0 + 20 * MIN), true)
afirmar('sucesso com o disjuntor fechado nao conta religamento', mod.registrarSucesso(), false)

// ── sucesso zera o contador de falhas seguidas ───────────────────────────────
mod.reiniciar()
for (let i = 0; i < 4; i++) mod.registrarFalha(T0)
mod.registrarSucesso()
for (let i = 0; i < 4; i++) mod.registrarFalha(T0)
afirmar('4 falhas + sucesso + 4 falhas NAO desliga (o sucesso zerou)', mod.podeEnriquecer(T0), true)

// ── o resumo conta o que o stdout vai imprimir ───────────────────────────────
mod.reiniciar()
for (let i = 0; i < 5; i++) mod.registrarFalha(T0)
mod.podeEnriquecer(T0); mod.podeEnriquecer(T0); mod.podeEnriquecer(T0)
const r = mod.resumo()
afirmar('resumo: 1 desligamento', r.desligamentos, 1)
afirmar('resumo: 3 chamadas puladas', r.puladas, 3)
afirmar('resumo: terminou aberto', r.aberto, true)

// ── O QUE PROVA O CONSERTO: o custo, no mesmo cenario ────────────────────────
// 500 registros, API de itens fora o tempo todo. Cada chamada tentada esgota
// 2+4+6+8+10 = 30s de backoff; chamada pulada custa zero.
const CUSTO_FALHA_MS = 30_000
const REGISTROS = 500

function simular({ comDisjuntor }) {
  mod.reiniciar()
  let relogio = T0, tentadas = 0
  for (let i = 0; i < REGISTROS; i++) {
    if (comDisjuntor && !mod.podeEnriquecer(relogio)) continue
    tentadas++
    relogio += CUSTO_FALHA_MS
    if (comDisjuntor) mod.registrarFalha(relogio)
  }
  return { tentadas, minutos: Math.round((relogio - T0) / MIN) }
}

const velho = simular({ comDisjuntor: false })
const novo = simular({ comDisjuntor: true })
console.log(`\n  custo de ${REGISTROS} registros com a API de itens fora:`)
console.log(`    SEM disjuntor (codigo antigo): ${velho.tentadas} chamadas · ${velho.minutos}min`)
console.log(`    COM disjuntor .............. : ${novo.tentadas} chamadas · ${novo.minutos}min\n`)

afirmar('sem disjuntor, TODOS os 500 registros pagam o backoff', velho.tentadas, REGISTROS)
afirmar('sem disjuntor o custo estoura o orcamento de 120min', velho.minutos > 120, true)
afirmar('com disjuntor o custo cabe no orcamento', novo.minutos <= 120, true)
afirmar('com disjuntor sao poucas chamadas (limite + sondas)', novo.tentadas < 20, true)

console.log(`\n${ok} ok · ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
