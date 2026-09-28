import { test } from 'node:test'
import assert from 'node:assert/strict'
import { faseDoFeed } from '../../src/lib/alertas-feed.mjs'

test('antes da primeira resposta o vazio é carregamento, mesmo sem busca em andamento', () => {
  // O render entre a montagem e o início do fetch: nada carregando, nada respondido.
  assert.equal(faseDoFeed({ respondeu: false, carregando: false, total: 0 }), 'carregando')
  assert.equal(faseDoFeed({ respondeu: false, carregando: true, total: 0 }), 'carregando')
})

test('"Nenhuma notificação" só depois que a busca respondeu vazia', () => {
  assert.equal(faseDoFeed({ respondeu: true, carregando: false, total: 0 }), 'vazio')
})

test('recarregar com a lista vazia mostra carregando; com itens, mantém a lista', () => {
  assert.equal(faseDoFeed({ respondeu: true, carregando: true, total: 0 }), 'carregando')
  assert.equal(faseDoFeed({ respondeu: false, carregando: true, total: 3 }), 'lista')
  assert.equal(faseDoFeed({ respondeu: true, carregando: false, total: 3 }), 'lista')
})
