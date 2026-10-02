// scripts/radar/saude-cliente.teste.ts — o que o CLIENTE vê sobre cada portal.
// Uso: npx tsx --test scripts/radar/saude-cliente.teste.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atrasadoParaCliente, contaExpirada, precisaAtencao } from '../../src/lib/radar/saude'

const agora = Date.parse('2026-10-02T12:00:00Z')
const ha = (min: number) => new Date(agora - min * 60000).toISOString()
const item = (status: string, verificadoEm: string | null) => ({ status, verificadoEm, tentadoEm: ha(1) }) as never

test('falha isolada logo depois de uma leitura boa: o admin vê, o cliente não', () => {
  // O BLL do print local: falhou, mas leu OK há 18 min.
  const s = item('falha', ha(18))
  assert.equal(precisaAtencao(s, agora), true)
  assert.equal(atrasadoParaCliente(s, agora), false)
})

test('portal sem leitura boa há dias: o cliente é avisado do atraso', () => {
  // Os 4 portais do print de produção: última verificação OK há 3 dias.
  assert.equal(atrasadoParaCliente(item('ok', ha(3 * 24 * 60)), agora), true)
  assert.equal(atrasadoParaCliente(item('falha', ha(3 * 24 * 60)), agora), true)
  assert.equal(atrasadoParaCliente(item('portal_indisponivel', ha(7 * 60)), agora), true)
})

test('dentro das 6 h, qualquer estado de portal é cadência normal para o cliente', () => {
  assert.equal(atrasadoParaCliente(item('ok', ha(5 * 60)), agora), false)
  assert.equal(atrasadoParaCliente(item('portal_indisponivel', ha(60)), agora), false)
})

test('portal que nunca leu, mas já tentou e falhou, conta como atrasado', () => {
  assert.equal(atrasadoParaCliente(item('falha', null), agora), true)
  assert.equal(atrasadoParaCliente(item('nunca_verificado', null), agora), false)
  assert.equal(atrasadoParaCliente(item('nao_monitorado', null), agora), false)
})

test('conta expirada é "reconecte", nunca "atrasado"', () => {
  const s = item('sessao_expirada', ha(10 * 24 * 60))
  assert.equal(contaExpirada(s), true)
  assert.equal(atrasadoParaCliente(s, agora), false)
})
