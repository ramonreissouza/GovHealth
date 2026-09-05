// scripts/pncp-prioridade.teste.mjs — a fila deixa passar quem tem que passar?
//
// Existe pelo mesmo motivo do teste do lock: o modo de falha é INVISÍVEL. Se a fila
// errar, ninguém recebe erro — o sync-cobertura simplesmente continua desistindo todo
// dia, exatamente como já vinha fazendo, e o log dele parece normal. E o erro oposto é
// pior: um pedido órfão faria o dono ceder a pista para um processo morto, para sempre.
//
// Roda em diretório temporário: o módulo resolve `.pncp-fila` por process.cwd(), então
// a fila de produção fica intocada.
//
// Uso: npm run pncp:fila:teste     (sai 1 se algum caso falhar)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))

// Tempos em milissegundos para o teste exercitar em instantes o que leva minutos.
process.env.PNCP_FILA_POLL_MS = '20'
process.env.PNCP_FILA_GRACA_MS = '40'
process.env.PNCP_FILA_MIN_TRABALHO_MS = '60'
process.env.PNCP_FILA_MEMO_MS = '1'

// cwd isolado ANTES de importar: é no import que PASTA e ARQUIVO são resolvidos.
const caixa = fs.mkdtempSync(path.join(os.tmpdir(), 'pncp-fila-teste-'))
process.chdir(caixa)
const url = (f) => `file://${path.join(AQUI, f).replace(/\\/g, '/')}`
const fila = await import(url('pncp-prioridade.mjs'))
const lock = await import(url('pncp-lock.mjs'))
const PASTA = path.join(caixa, '.pncp-fila')

let ok = 0
let falhou = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function conferir(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado)
  if (bate) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         real:     ${JSON.stringify(real)}`) }
}

/** Pedido de um PID que existe mas não é este processo. O PID 4 (System) serve no
 *  Windows; em POSIX o 1 (init). O que importa é `kill(pid,0)` não dar ESRCH. */
const PID_VIVO_ALHEIO = process.platform === 'win32' ? 4 : 1

function semear(pid, dono, prioridade) {
  fs.mkdirSync(PASTA, { recursive: true })
  fs.writeFileSync(path.join(PASTA, `${pid}.json`), JSON.stringify({
    pid, dono, prioridade, desde: new Date().toISOString(),
  }))
}
const limpar = () => { try { fs.rmSync(PASTA, { recursive: true, force: true }) } catch {} }

console.log('\nprioridades declaradas')
conferir('sync-cobertura passa na frente do backfill-itens',
  fila.prioridadeDe('sync-cobertura') < fila.prioridadeDe('backfill-itens'), true)
conferir('quem não está na tabela cai no padrão 50', fila.prioridadeDe('inventado'), 50)

console.log('\nfila')
limpar()
semear(PID_VIVO_ALHEIO, 'sync-cobertura', 10)
conferir('pedido vivo aparece', fila.fila().map((p) => p.dono), ['sync-cobertura'])

semear(999999, 'fantasma', 1)
conferir('pedido de PID morto some da fila', fila.fila().map((p) => p.dono), ['sync-cobertura'])
conferir('e o arquivo do fantasma é apagado', fs.existsSync(path.join(PASTA, '999999.json')), false)

console.log('\npassagem')
limpar()
fila._zerarCache()
conferir('sem ninguém na fila, ninguém pede passagem', fila.devoCeder('backfill-itens'), false)

semear(PID_VIVO_ALHEIO, 'sync-cobertura', 10)
fila._zerarCache()
conferir('urgente na fila faz o longo ceder', fila.devoCeder('backfill-itens'), true)
conferir('e o urgente não cede para si mesmo', fila.devoCeder('sync-cobertura'), false)

limpar()
semear(PID_VIVO_ALHEIO, 'backfill-itens', 60)
fila._zerarCache()
conferir('pedido MENOS urgente não interrompe ninguém', fila.devoCeder('etl-refresh-loop'), false)

console.log('\ntrava de trabalho mínimo')
limpar()
semear(PID_VIVO_ALHEIO, 'sync-cobertura', 10)
fila._zerarCache({ trabalhandoHa: 0 })
conferir('recém-retomado não cede de novo na hora', fila.devoCeder('backfill-itens'), false)
await sleep(80)
fila._zerarCache({ trabalhandoHa: 80 })
conferir('passado o mínimo de trabalho, cede', fila.devoCeder('backfill-itens'), true)

console.log('\nesperarVez')
limpar()
lock.soltar()
conferir('pista livre: pega na hora', await fila.esperarVez('sync-cobertura', { log: () => {} }), true)
conferir('e o lock ficou com o dono certo', lock.estado().dono, 'sync-cobertura')
conferir('e o pedido saiu da fila', fila.fila().length, 0)
lock.soltar()

// Ocupada por um PID vivo alheio: tem de desistir no teto, não travar para sempre.
fs.writeFileSync(path.join(caixa, '.pncp-ocupado'), JSON.stringify({
  pid: PID_VIVO_ALHEIO, dono: 'outro', desde: new Date().toISOString(), anuncia: true,
}))
const t0 = Date.now()
conferir('pista ocupada: desiste no teto', await fila.esperarVez('sync-cobertura', { esperaMaxMin: 0.002, log: () => {} }), false)
conferir('e desistir não demorou mais que o teto', Date.now() - t0 < 3000, true)
conferir('e não deixou pedido pendurado na fila', fila.fila().length, 0)
lock.soltar()
limpar()

console.log(`\n${ok} ok · ${falhou} falharam`)
process.chdir(os.tmpdir())
try { fs.rmSync(caixa, { recursive: true, force: true }) } catch {}
process.exit(falhou ? 1 : 0)
