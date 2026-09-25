// scripts/radar/limite-credencial.teste.mjs — o limite é por conexão, não pelo IP da Vercel.
//
// O caso da revisão da #35: todos os tenants chegam ao nginx com o IP de saída da
// Vercel, e um balde por IP deixava um usuário insistente travar a captura e o
// cancelamento de outro. Relógio virtual; nada dorme.

import { criarLimitador, respostaLimite, LIMITES } from './limite-credencial.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

console.log('\nlimite-credencial — por conexão, por rota\n')

// 1) O CASO DA REVISÃO: A insiste em abrir sessão; B continua capturando e cancelando.
{
  let t = 0
  const lim = criarLimitador({ agora: () => t })
  let recusadasA = 0
  for (let i = 0; i < 50; i++) if (!lim.permitir('session', 'cred-A').ok) recusadasA++
  afirmar('A insistente: é contida', recusadasA, 50 - LIMITES.session.rajada)
  afirmar('B não é afetado: abre sessão', lim.permitir('session', 'cred-B').ok, true)
  afirmar('B não é afetado: captura', lim.permitir('capture', 'cred-B').ok, true)
  afirmar('B não é afetado: cancela', lim.permitir('cancel', 'cred-B').ok, true)
}

// 2) Cada rota tem o seu balde: quem esgotou /session ainda consegue CANCELAR — é o
//    cancelamento que devolve o navegador para os outros.
{
  let t = 0
  const lim = criarLimitador({ agora: () => t })
  for (let i = 0; i < 10; i++) lim.permitir('session', 'cred-A')
  afirmar('session esgotada: ela mesma recusa', lim.permitir('session', 'cred-A').ok, false)
  afirmar('session esgotada: cancelar continua liberado', lim.permitir('cancel', 'cred-A').ok, true)
  afirmar('session esgotada: capturar continua liberado', lim.permitir('capture', 'cred-A').ok, true)
}

// 3) As fichas voltam com o tempo, e o prazo informado é o real.
{
  let t = 0
  const lim = criarLimitador({ agora: () => t })
  for (let i = 0; i < LIMITES.session.rajada; i++) lim.permitir('session', 'c')
  const r = lim.permitir('session', 'c')
  afirmar('esgotado: recusa', r.ok, false)
  afirmar('esgotado: diz quando tentar (6/min → 10 s)', r.retryAfter, 10)
  t += 9_000
  afirmar('antes do prazo: ainda recusa', lim.permitir('session', 'c').ok, false)
  t += 1_500
  afirmar('passado o prazo: libera', lim.permitir('session', 'c').ok, true)
}

// 4) Uso normal nunca bate no limite: conectar, clicar "já concluí" algumas vezes, e
//    reconectar depois de um erro.
{
  let t = 0
  const lim = criarLimitador({ agora: () => t })
  const r = []
  r.push(lim.permitir('session', 'c').ok)
  for (let i = 0; i < 6; i++) { t += 5_000; r.push(lim.permitir('capture', 'c').ok) }
  r.push(lim.permitir('cancel', 'c').ok)
  r.push(lim.permitir('session', 'c').ok)
  afirmar('uso normal: nada recusado', r.every(Boolean), true)
}

// 5) O mapa não cresce sem fim: baldes que já se encheram de novo são esquecidos.
{
  let t = 0
  const lim = criarLimitador({ agora: () => t, maxChaves: 100 })
  for (let i = 0; i < 100; i++) lim.permitir('session', `c${i}`)
  t += 10 * 60_000
  lim.permitir('session', 'novo')
  afirmar('poda: sobra só o balde recém-usado', lim._baldes.size, 1)
}

// 6) Rota desconhecida não é limitada aqui (o roteador já devolve 404).
{
  const lim = criarLimitador()
  afirmar('rota fora da tabela: não interfere', lim.permitir('outra', 'c').ok, true)
}

// 7) O 429 é JSON com `error` — o proxy do Next repassa sem confundir com pane.
{
  const r = respostaLimite('session', 10)
  afirmar('429: `error` e `detalhe` são a frase (a tela lê um ou outro)', [r.error === r.erro, r.detalhe === r.erro], [true, true])
  afirmar('429: o código máquina fica à parte', r.codigo, 'limite_por_conexao')
  afirmar('429: diz o prazo', r.retryAfter, 10)
  afirmar('429: a frase diz o que fazer', /Aguarde 10 s/.test(r.erro), true)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
