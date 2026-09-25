// scripts/radar/rodizio.teste.mjs — o rodízio da passada pública. Sem rede, sem banco.
//
// O caso 4 é O QUE MORDE: reproduz o Licitanet de 22/09/2026 (60 processos, o portal
// corta no 21º) por várias passadas e exige que TODOS os 60 tenham sido lidos ao menos
// uma vez. Foi a ausência exata disso que deixou os processos 22 a 60 sem leitura
// nenhuma, passada após passada, com a tela dizendo "21 lidos".

import { rotacionar, proximoOffset, chaveRodizio, explicarRodizio } from './rodizio.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const L = ['a', 'b', 'c', 'd', 'e']

// 1) A VOLTA COMEÇA ONDE MANDAM, E A ORDEM RELATIVA NÃO MUDA ─────────────────────────
{
  afirmar('offset 0 devolve igual', rotacionar(L, 0), ['a', 'b', 'c', 'd', 'e'])
  afirmar('offset 2 gira', rotacionar(L, 2), ['c', 'd', 'e', 'a', 'b'])
  afirmar('offset = tamanho volta ao inicio', rotacionar(L, 5), ['a', 'b', 'c', 'd', 'e'])
  afirmar('offset maior que o tamanho da volta', rotacionar(L, 7), ['c', 'd', 'e', 'a', 'b'])
  afirmar('nao perde nem duplica ninguem', rotacionar(L, 3).slice().sort(), ['a', 'b', 'c', 'd', 'e'])
  afirmar('nao muta a entrada', L, ['a', 'b', 'c', 'd', 'e'])
}

// 2) OFFSET SUJO NÃO DERRUBA A PASSADA ───────────────────────────────────────────────
//    O valor vem do banco (`etl_checkpoint.ultima_pagina`), e banco devolve NULL, texto
//    e número negativo. Um NaN aqui embaralharia a lista ou lançaria no meio da coleta.
{
  afirmar('null vira 0', rotacionar(L, null), ['a', 'b', 'c', 'd', 'e'])
  afirmar('undefined vira 0', rotacionar(L, undefined), ['a', 'b', 'c', 'd', 'e'])
  afirmar('texto nao numerico vira 0', rotacionar(L, 'abc'), ['a', 'b', 'c', 'd', 'e'])
  afirmar('negativo conta de tras', rotacionar(L, -1), ['e', 'a', 'b', 'c', 'd'])
  afirmar('fracionario e truncado', rotacionar(L, 2.9), ['c', 'd', 'e', 'a', 'b'])
  afirmar('lista vazia devolve vazia', rotacionar([], 3), [])
  afirmar('nao-lista devolve vazia', rotacionar(null, 3), [])
}

// 3) O PONTO ANDA PELO QUE FOI LIDO, NÃO PELO QUE FOI ENTREGUE ───────────────────────
{
  afirmar('leu 21 de 60 a partir do 0', proximoOffset(0, 21, 60), 21)
  afirmar('leu 21 de 60 a partir do 21', proximoOffset(21, 21, 60), 42)
  afirmar('da a volta', proximoOffset(42, 21, 60), 3)
  afirmar('leu tudo: volta ao mesmo ponto', proximoOffset(7, 60, 60), 7)
  // NADA LIDO NÃO ANDA. Portal fora do ar não é leitura; andar aqui pularia um pedaco
  // da lista que nunca chegou a ser tentado.
  afirmar('leu 0: o ponto nao anda', proximoOffset(21, 0, 60), 21)
  afirmar('lidos negativo nao anda', proximoOffset(21, -5, 60), 21)
  afirmar('total 0 devolve 0', proximoOffset(21, 10, 0), 0)
  afirmar('lidos nao numerico nao anda', proximoOffset(9, 'x', 60), 9)
}

// 4) O CASO REAL: 60 PROCESSOS, O PORTAL CORTA NO 21º ────────────────────────────────
//    Sem rodízio, 22..60 nunca eram lidos. Aqui: em quantas passadas todos são lidos?
{
  const TOTAL = 60
  const CORTE = 21
  const lista = Array.from({ length: TOTAL }, (_, i) => i)
  const lidosAlgumaVez = new Set()
  let offset = 0
  let passadas = 0
  while (lidosAlgumaVez.size < TOTAL && passadas < 50) {
    passadas++
    const volta = rotacionar(lista, offset)
    for (const p of volta.slice(0, CORTE)) lidosAlgumaVez.add(p)
    offset = proximoOffset(offset, CORTE, TOTAL)
  }
  afirmar('cobre os 60 processos', lidosAlgumaVez.size, TOTAL)
  afirmar('em 3 passadas', passadas, 3)

  // E a prova do contrário: SEM rodízio, o mesmo cenário nunca passa de 21.
  const semRodizio = new Set()
  for (let i = 0; i < 50; i++) for (const p of lista.slice(0, CORTE)) semRodizio.add(p)
  afirmar('sem rodizio, 50 passadas leem sempre os mesmos 21', semRodizio.size, CORTE)
}

// 5) CORTE IRREGULAR (o portal nem sempre corta no mesmo lugar) ──────────────────────
//    O WAF deles não é determinístico. O rodízio não pode depender de um corte fixo.
{
  const TOTAL = 47
  const lista = Array.from({ length: TOTAL }, (_, i) => i)
  const cortes = [13, 8, 21, 5, 19, 11, 30, 2, 17]
  const vistos = new Set()
  let offset = 0
  for (let i = 0; i < 40; i++) {
    const corte = cortes[i % cortes.length]
    for (const p of rotacionar(lista, offset).slice(0, corte)) vistos.add(p)
    offset = proximoOffset(offset, corte, TOTAL)
  }
  afirmar('corte irregular tambem cobre tudo', vistos.size, TOTAL)
}

// 6) UMA PASSADA EM QUE O PORTAL ESTÁ FORA NÃO PULA NINGUÉM ──────────────────────────
{
  const TOTAL = 10
  const lista = Array.from({ length: TOTAL }, (_, i) => i)
  let offset = 0
  offset = proximoOffset(offset, 4, TOTAL)   // leu 0..3
  const quedaEm = offset
  offset = proximoOffset(offset, 0, TOTAL)   // portal fora: nada lido
  afirmar('queda nao move o ponto', offset, quedaEm)
  afirmar('a volta seguinte retoma no 5o', rotacionar(lista, offset)[0], 4)
}

// 7) CHAVE E FRASE ───────────────────────────────────────────────────────────────────
{
  afirmar('a chave separa portal e titular',
    chaveRodizio('licitanet', 'admin@govhealth.ai'), 'radar:rodizio:licitanet:admin@govhealth.ai')
  afirmar('frase no inicio da lista', explicarRodizio(0, 60), 'volta começando do 1º de 60')
  afirmar('frase no meio', explicarRodizio(21, 60),
    'volta começando do 22º de 60 (os anteriores foram lidos na passada passada)')
  afirmar('sem lista, sem frase', explicarRodizio(3, 0), '')
  // A lista encolheu desde a última passada: a frase diz onde a volta DE FATO começa,
  // que é o que `rotacionar` faz — não um "115º de 2" que não existe.
  afirmar('lista encolheu: a frase aplica o mesmo módulo', explicarRodizio(115, 2),
    'volta começando do 2º de 2 (os anteriores foram lidos na passada passada)')
  afirmar('frase e rotação concordam', explicarRodizio(115, 2).includes(`${rotacionar([1, 2], 115)[0]}º`), true)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
