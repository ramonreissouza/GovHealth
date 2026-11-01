// scripts/lib/e2e-guarda.teste.mjs — a guarda que impede um e2e de apagar banco real.
// Uso: npm run e2e:guarda:teste
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conferirHostE2E, exigirBancoDescartavel, CONFIRMACAO_E2E } from './e2e-guarda.mjs'

/** Cliente falso: responde current_database() com `banco` e registra o que foi pedido. */
const cliente = (banco) => {
  const pedidos = []
  return { pedidos, query: async (sql) => { pedidos.push(sql); return { rows: [{ banco }] } } }
}
const OK = { ALLOW_DESTRUCTIVE_E2E: CONFIRMACAO_E2E }

test('localhost com o banco de PRODUÇÃO (port-forward do k3s) é recusado', async () => {
  conferirHostE2E('postgres://govhealth:x@localhost:5432/govhealth') // host local passa…
  await assert.rejects(exigirBancoDescartavel(cliente('govhealth'), OK), /recuso apagar o banco "govhealth"/) // …o nome não
})

test('nome que só CONTÉM e2e não basta', async () => {
  await assert.rejects(exigirBancoDescartavel(cliente('e2e_govhealth'), OK), /termina em _e2e/)
  await assert.rejects(exigirBancoDescartavel(cliente('e2e'), OK), /termina em _e2e/)
})

test('sem a confirmação explícita, recusa antes de consultar o banco', async () => {
  const c = cliente('auth_e2e')
  await assert.rejects(exigirBancoDescartavel(c, {}), /ALLOW_DESTRUCTIVE_E2E/)
  await assert.rejects(exigirBancoDescartavel(c, { ALLOW_DESTRUCTIVE_E2E: 'sim' }), /ALLOW_DESTRUCTIVE_E2E/)
  assert.equal(c.pedidos.length, 0)
})

test('host remoto é recusado', () => {
  assert.throws(() => conferirHostE2E('postgres://u:p@govhealth.techealth.com.br:5432/auth_e2e'), /só host local/)
})

test('banco local *_e2e com confirmação: liberado', async () => {
  conferirHostE2E('postgres://postgres:teste@127.0.0.1:55494/auth_e2e')
  assert.equal(await exigirBancoDescartavel(cliente('auth_e2e'), OK), 'auth_e2e')
})
