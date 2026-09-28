// scripts/pncp-pista-pods.teste.mjs — a pista do PNCP entre pods do k3s.
//
// No k3s cada tarefa é um pod: o PID se repete entre pods e `kill(pid, 0)` não enxerga
// processo de outro pod. Estes casos provam que a pista não confunde "outro pod" com
// "morto" (o que criaria dois donos) nem com "eu" (o que soltaria o lock alheio).
//
// Uso: node --test scripts/pncp-pista-pods.teste.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
// Antes do import: é nele que a pasta e os tempos são resolvidos.
const PISTA = fs.mkdtempSync(path.join(os.tmpdir(), 'pncp-pista-pods-'))
process.env.PNCP_PISTA_DIR = PISTA
process.env.PNCP_FILA_MEMO_MS = '1'
process.env.PNCP_FILA_MIN_TRABALHO_MS = '1'
process.env.PNCP_FILA_SILENCIO_MS = '60000'
const url = (f) => `file://${path.join(AQUI, f).replace(/\\/g, '/')}`
const lock = await import(url('pncp-lock.mjs'))
const fila = await import(url('pncp-prioridade.mjs'))

const LOCK = path.join(PISTA, '.pncp-ocupado')
const FILA = path.join(PISTA, '.pncp-fila')
const OUTRO_POD = `${lock.HOST}-outro-pod`
const PID_INEXISTENTE = 4_000_000 + 123
const minAtras = (m) => new Date(Date.now() - m * 60000).toISOString()
const limpar = () => { fs.rmSync(LOCK, { force: true }); fs.rmSync(FILA, { recursive: true, force: true }) }

test('a pista mora em PNCP_PISTA_DIR, com o host de quem pegou', () => {
  limpar()
  assert.equal(lock.pegar('teste'), true)
  const info = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
  assert.equal(info.host, lock.HOST)
  assert.equal(info.pid, process.pid)
  lock.soltar()
  assert.equal(fs.existsSync(LOCK), false)
})

test('dono em outro pod, anunciado há pouco: ocupado, mesmo com PID que não existe aqui', () => {
  limpar()
  fs.writeFileSync(LOCK, JSON.stringify({ pid: PID_INEXISTENTE, host: OUTRO_POD, dono: 'etl-refresh-loop', desde: minAtras(4), anuncia: true }))
  assert.deepEqual(lock.estado(), { ocupado: true, dono: 'etl-refresh-loop' })
  assert.equal(lock.pegar('sync-cobertura'), false)
})

test('dono em outro pod que parou de se anunciar há mais de 30 min: descartado', () => {
  limpar()
  fs.writeFileSync(LOCK, JSON.stringify({ pid: PID_INEXISTENTE, host: OUTRO_POD, dono: 'morto', desde: minAtras(31), anuncia: true }))
  const e = lock.estado()
  assert.equal(e.ocupado, false)
  assert.match(e.motivo, /sem se anunciar/)
})

test('mesmo PID em outro pod não é "eu": soltar() não apaga o lock dele', () => {
  limpar()
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, host: OUTRO_POD, dono: 'alheio', desde: minAtras(1), anuncia: true }))
  lock.soltar()
  assert.equal(fs.existsSync(LOCK), true)
  assert.equal(lock.estado().ocupado, true)
})

test('no mesmo host a regra antiga continua: PID morto é lock órfão', () => {
  limpar()
  fs.writeFileSync(LOCK, JSON.stringify({ pid: PID_INEXISTENTE, host: lock.HOST, dono: 'morto', desde: minAtras(1), anuncia: true }))
  assert.equal(lock.estado().ocupado, false)
  // e o registro da versão anterior, sem host, também
  fs.writeFileSync(LOCK, JSON.stringify({ pid: PID_INEXISTENTE, dono: 'legado', desde: minAtras(1) }))
  assert.equal(lock.estado().ocupado, false)
})

test('fila: pedido de outro pod vale enquanto é renovado e sai quando silencia', () => {
  limpar()
  fs.mkdirSync(FILA, { recursive: true })
  const pedido = (nome, desde) => fs.writeFileSync(path.join(FILA, `${nome}.json`),
    JSON.stringify({ pid: PID_INEXISTENTE, host: OUTRO_POD, dono: 'sync-cobertura', prioridade: 10, desde }))
  pedido('vivo', minAtras(0.5))
  pedido('morto', minAtras(5))
  const vivos = fila.fila()
  assert.equal(vivos.length, 1)
  assert.equal(vivos[0].dono, 'sync-cobertura')
  assert.equal(fs.existsSync(path.join(FILA, 'morto.json')), false)
})

test('passagem: o dono cede ao urgente de outro pod, e não a si mesmo com PID repetido', () => {
  limpar()
  fila._zerarCache()
  fs.mkdirSync(FILA, { recursive: true })
  // Mesmo PID deste processo, outro pod: é outra pessoa na fila, não eu.
  fs.writeFileSync(path.join(FILA, 'urgente.json'), JSON.stringify({ pid: process.pid, host: OUTRO_POD, dono: 'sync-cobertura', prioridade: 10, desde: minAtras(0) }))
  assert.equal(fila.quemPedePassagem('backfill-itens')?.dono, 'sync-cobertura')
  // O meu próprio pedido nunca me faz ceder.
  fs.rmSync(path.join(FILA, 'urgente.json'))
  fila._zerarCache()
  fila.entrarNaFila('sync-cobertura')
  assert.equal(fila.quemPedePassagem('backfill-itens'), null)
  fila.sairDaFila()
  limpar()
})
