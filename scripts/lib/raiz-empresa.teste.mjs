import { test } from 'node:test'
import assert from 'node:assert/strict'
import { raizEmpresa } from './raiz-empresa.mjs'

test('variações do mesmo grupo viram a mesma raiz', () => {
  for (const nome of [
    'ACME MEDICAL LTDA',
    'ACME MEDICAL S.A.',
    'ACME MEDICAL S/A',
    'ACME MEDICAL SA',
    'ACME MEDICAL S A',
    'Acme Medical Eireli',
    'ACME MEDICAL - ME',
    'ACME MEDICAL LTDA - EPP',
    'ACME MEDICAL EPP',
    '  ACME   MEDICAL    LTDA  ',
    'ACME MEDICAL LTDA.',
  ]) assert.equal(raizEmpresa(nome), 'ACME MEDICAL', nome)
})

test('não corta palavra que só começa como sufixo', () => {
  assert.equal(raizEmpresa('MEDIMEX EQUIPAMENTOS MEDICOS LTDA'), 'MEDIMEX EQUIPAMENTOS MEDICOS')
  assert.equal(raizEmpresa('SAMTRONIC SAUDE LTDA'), 'SAMTRONIC SAUDE')
  assert.equal(raizEmpresa('EPPENDORF DO BRASIL LTDA'), 'EPPENDORF DO BRASIL')
  assert.equal(raizEmpresa('LTDAMED COMERCIO'), 'LTDAMED COMERCIO')
})

test('nome sem sufixo fica como está, em maiúsculas', () => {
  assert.equal(raizEmpresa('Philips do Brasil'), 'PHILIPS DO BRASIL')
  assert.equal(raizEmpresa(''), '')
  assert.equal(raizEmpresa(null), '')
})
