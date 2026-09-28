import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fasesDoQuadro } from '../../src/lib/radar/quadro-oficial.mjs'

test('antes do load: a camada cobre o quadro (e segura os cliques), sem rodapé', () => {
  assert.deepEqual(fasesDoQuadro({ carregou: false, passouDoTempo: false }), { camada: true, avisoDemora: false, rodapeSaida: false })
})

test('demorou: a camada continua e ganha o aviso de demora', () => {
  assert.deepEqual(fasesDoQuadro({ carregou: false, passouDoTempo: true }), { camada: true, avisoDemora: true, rodapeSaida: false })
})

test('load seguido de conteúdo indisponível: a saída continua à vista', () => {
  // O Radar não distingue "abriu" de "recusou o quadro": nos dois casos o navegador
  // dispara `load`. O que importa é não sumir com a saída.
  const f = fasesDoQuadro({ carregou: true, passouDoTempo: true })
  assert.equal(f.camada, false)
  assert.equal(f.avisoDemora, false)
  assert.equal(f.rodapeSaida, true)
})
