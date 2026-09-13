// scripts/radar/pista-navegador.teste.mjs — a pista do navegador hospedado.
//
// O modo de falha aqui NAO e o servico cair: e gravar a sessao gov.br de um cliente
// como credencial de outro, em silencio, com as duas telas dizendo "conectado". O
// steel open-source roda UMA sessao por vez (activeSession, nao um mapa) e a captura
// le contexts()[0] do navegador unico — sem esta pista, quem capturar depois leva o
// que estiver carregado.
//
// O bloco final e o que importa: ele encena o vazamento com a regra ANTIGA (sem
// pista) e exige que a NOVA recuse. Teste que passa no codigo velho nao prova nada.

process.env.RADAR_PISTA_TTL_MIN = '10'
const p = await import('./pista-navegador.mjs')

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const T0 = 1_700_000_000_000
const MIN = 60_000
const A = 'cred-siemens'
const B = 'cred-prime'

// ── tomar a pista ────────────────────────────────────────────────────────────
console.log('\n── tomar e recusar ──')
p.reiniciar()
afirmar('pista livre: A entra', p.pegar(A, { agora: T0 }).ok, true)
const vezB = p.pegar(B, { agora: T0 + MIN })
afirmar('B e RECUSADO enquanto A esta dentro', vezB.ok, false)
afirmar('e o motivo e explicito', vezB.motivo, 'ocupada')
afirmar('B recebe quanto falta esperar', vezB.esperaMs, 9 * MIN)
afirmar('A retomando a si mesmo nao e recusado', p.pegar(A, { agora: T0 + 2 * MIN }).ok, true)
afirmar('credencial vazia nao toma pista', p.pegar('', { agora: T0 }).ok, false)

// ── o prazo ──────────────────────────────────────────────────────────────────
// Sem prazo, quem fecha a aba no meio do login tranca a pista para sempre: trocariamos
// o vazamento por uma negacao de servico permanente.
console.log('\n── o prazo solta a pista abandonada ──')
p.reiniciar()
p.pegar(A, { agora: T0 })
afirmar('9min depois ainda e de A', p.pegar(B, { agora: T0 + 9 * MIN }).ok, false)
afirmar('10min depois expirou e B entra', p.pegar(B, { agora: T0 + 10 * MIN }).ok, true)

// ── a fronteira da captura ───────────────────────────────────────────────────
console.log('\n── quem pode capturar ──')
p.reiniciar()
p.pegar(A, { agora: T0 })
p.anotarSessao(A, { sessionId: 'sess-111', token: 'tok-a' })

afirmar('A captura a propria sessao', p.podeCapturar(A, 'sess-111', { agora: T0 + MIN }).ok, true)

const outro = p.podeCapturar(B, 'sess-111', { agora: T0 + MIN })
afirmar('B NAO captura a sessao de A', outro.ok, false)
afirmar('e o motivo diz por que', outro.motivo, 'outra credencial está conectando agora')

// O caso que vaza de verdade: a pista e de A, mas o steel ja trocou de sessao (alguem
// chamou POST /sessions, que MATA a ativa). O navegador carregado nao e mais o de A.
const trocou = p.podeCapturar(A, 'sess-999', { agora: T0 + MIN })
afirmar('sessao viva DIFERENTE da anotada: recusa', trocou.ok, false)
afirmar('e diz que a sessao nao e desta credencial', trocou.motivo.includes('não é a desta credencial'), true)

afirmar('sem sessao anotada nao captura', (() => { p.reiniciar(); p.pegar(A, { agora: T0 }); return p.podeCapturar(A, 'sess-111', { agora: T0 }).ok })(), false)
afirmar('pista expirada nao captura', (() => { p.reiniciar(); p.pegar(A, { agora: T0 }); p.anotarSessao(A, { sessionId: 's' }); return p.podeCapturar(A, 's', { agora: T0 + 11 * MIN }).ok })(), false)

// steel mudo (null) nao vira "esta tudo certo": decide-se pela pista, que ainda vale.
afirmar('steel sem resposta: decide pela pista', (() => { p.reiniciar(); p.pegar(A, { agora: T0 }); p.anotarSessao(A, { sessionId: 's' }); return p.podeCapturar(A, null, { agora: T0 }).ok })(), true)

// ── o token do live view ─────────────────────────────────────────────────────
console.log('\n── o porteiro do live view ──')
p.reiniciar()
p.pegar(A, { agora: T0 })
p.anotarSessao(A, { sessionId: 'sess-111', token: 'a'.repeat(64) })
afirmar('token certo abre', p.donoDoToken('a'.repeat(64), { agora: T0 })?.credencialId, A)
afirmar('token errado do mesmo tamanho nao abre', p.donoDoToken('b'.repeat(64), { agora: T0 }), null)
afirmar('token de outro tamanho nao abre', p.donoDoToken('a'.repeat(10), { agora: T0 }), null)
afirmar('token vazio nao abre', p.donoDoToken('', { agora: T0 }), null)
afirmar('token morre com a pista', (() => { p.soltar(A); return p.donoDoToken('a'.repeat(64), { agora: T0 }) })(), null)
afirmar('token morre no prazo', (() => {
  p.reiniciar(); p.pegar(A, { agora: T0 }); p.anotarSessao(A, { token: 'c'.repeat(64) })
  return p.donoDoToken('c'.repeat(64), { agora: T0 + 11 * MIN })
})(), null)

// ── soltar ───────────────────────────────────────────────────────────────────
console.log('\n── soltar ──')
p.reiniciar()
p.pegar(A, { agora: T0 })
afirmar('B nao solta a pista de A', p.soltar(B), false)
afirmar('e ela continua de A', p.estado(T0).credencialId, A)
afirmar('A solta a propria', p.soltar(A), true)
afirmar('e fica livre', p.estado(T0).ocupada, false)

// ── encenando o vazamento que a pista impede ─────────────────────────────────
// Com a regra ANTIGA (sem pista), capturar so olhava "tem conexao_session_id?" e lia
// contexts()[0]. Reproduzido abaixo: A abre o login, B entra por cima (o POST do steel
// mata a sessao de A e deixa a de B carregada), e A chama capturar.
console.log('\n── o vazamento, com a regra antiga e com a nova ──')
function capturaAntiga(credencial, sessionIdNoBanco, sessaoCarregadaNoNavegador) {
  // Era isto: se o banco tem um id, captura o que estiver no navegador.
  if (!sessionIdNoBanco) return { gravou: false }
  return { gravou: true, sessaoGravada: sessaoCarregadaNoNavegador }
}
const ANTIGO = capturaAntiga(A, 'sess-A', 'sess-B-do-outro-cliente')
afirmar('ANTES: A gravava a sessao de B como sendo dele', ANTIGO.sessaoGravada, 'sess-B-do-outro-cliente')
afirmar('ANTES: e a gravacao acontecia', ANTIGO.gravou, true)

p.reiniciar()
p.pegar(A, { agora: T0 }); p.anotarSessao(A, { sessionId: 'sess-A', token: 'x'.repeat(64) })
p.pegar(B, { agora: T0 + 11 * MIN }) // B so entra depois do prazo de A — o caminho honesto
p.anotarSessao(B, { sessionId: 'sess-B-do-outro-cliente' })
const NOVO = p.podeCapturar(A, 'sess-B-do-outro-cliente', { agora: T0 + 12 * MIN })
afirmar('DEPOIS: A e recusado', NOVO.ok, false)
afirmar('DEPOIS: o motivo e a credencial errada', NOVO.motivo, 'outra credencial está conectando agora')

console.log(`\n${ok} ok · ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
