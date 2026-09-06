// scripts/pncp-prioridade.integrado.teste.mjs — a passagem funciona entre DOIS processos?
//
// O teste unitário confere a lógica da fila com pedidos semeados à mão. Isso não prova
// o que importa: que um consumidor longo, com a pista na mão, larga a pista quando um
// urgente chega, e que o urgente ENTRA. É um aperto de mão entre processos separados,
// via dois arquivos em disco, e cada metade pode parecer certa sozinha enquanto o
// conjunto não funciona — que é exatamente o modo de falha que este projeto já viu:
// ninguém recebe erro, o sync-cobertura só continua desistindo todo dia.
//
// Uso: npm run pncp:fila:teste:e2e     (sai 1 se falhar)

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const MOD = (f) => `file://${path.join(AQUI, f).replace(/\\/g, '/')}`

const caixa = fs.mkdtempSync(path.join(os.tmpdir(), 'pncp-fila-e2e-'))
const AMBIENTE = {
  ...process.env,
  PNCP_FILA_POLL_MS: '50',
  PNCP_FILA_GRACA_MS: '150',
  PNCP_FILA_MIN_TRABALHO_MS: '200',
  PNCP_FILA_MEMO_MS: '10',
}

// O longo: pega a pista e trabalha em laço, conferindo se alguém pediu passagem.
fs.writeFileSync(path.join(caixa, 'longo.mjs'), `
process.chdir(${JSON.stringify(caixa)})
const fila = await import(${JSON.stringify(MOD('pncp-prioridade.mjs'))})
const lock = await import(${JSON.stringify(MOD('pncp-lock.mjs'))})
const fs = (await import('node:fs')).default
const marcar = (n) => fs.appendFileSync('eventos.txt', n + ' ' + Date.now() + '\\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

lock.pegar('backfill-itens')
marcar('longo:pegou')
const fim = Date.now() + 6000
while (Date.now() < fim) {
  if (fila.devoCeder('backfill-itens')) {
    marcar('longo:vai-ceder')
    await fila.ceder('backfill-itens', { log: () => {} })
    marcar('longo:retomou')
    break
  }
  await sleep(30)
}
lock.soltar()
marcar('longo:saiu')
`)

// O urgente: chega depois e pede a vez.
fs.writeFileSync(path.join(caixa, 'urgente.mjs'), `
process.chdir(${JSON.stringify(caixa)})
const fila = await import(${JSON.stringify(MOD('pncp-prioridade.mjs'))})
const lock = await import(${JSON.stringify(MOD('pncp-lock.mjs'))})
const fs = (await import('node:fs')).default
const marcar = (n) => fs.appendFileSync('eventos.txt', n + ' ' + Date.now() + '\\n')

marcar('urgente:pediu')
const pegou = await fila.esperarVez('sync-cobertura', { esperaMaxMin: 0.1, log: () => {} })
marcar('urgente:' + (pegou ? 'entrou' : 'DESISTIU'))
if (pegou) { await new Promise((r) => setTimeout(r, 200)); lock.soltar() }
marcar('urgente:saiu')
`)

const rodar = (f) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(caixa, f)], { cwd: caixa, env: AMBIENTE, stdio: 'inherit' })
  p.on('exit', (c) => resolve(c ?? 1))
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const longo = rodar('longo.mjs')
await sleep(700) // deixa o longo passar do piso de trabalho mínimo
const urgente = rodar('urgente.mjs')
await Promise.all([longo, urgente])

const eventos = fs.readFileSync(path.join(caixa, 'eventos.txt'), 'utf8').trim().split('\n')
  .map((l) => { const [nome, t] = l.split(' '); return { nome, t: Number(t) } })
const quando = (n) => eventos.find((e) => e.nome === n)?.t
const tem = (n) => quando(n) !== undefined

let ok = 0
let falhou = 0
const conferir = (nome, real, esperado = true) => {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome} — esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`) }
}

console.log('\nordem dos acontecimentos:')
for (const e of eventos) console.log(`  ${e.nome}`)
console.log('')

conferir('o longo pegou a pista primeiro', tem('longo:pegou'))
conferir('o longo percebeu o pedido', tem('longo:vai-ceder'))
conferir('o urgente ENTROU (não desistiu)', tem('urgente:entrou'))
conferir('o longo cedeu ANTES de o urgente entrar', quando('longo:vai-ceder') <= quando('urgente:entrou'))
conferir('o urgente entrou depois de pedir', quando('urgente:entrou') >= quando('urgente:pediu'))
conferir('o longo RETOMOU depois (cessão é pausa, não desistência)', tem('longo:retomou'))
conferir('o longo só retomou depois de o urgente sair', quando('longo:retomou') >= quando('urgente:saiu'))

const espera = quando('urgente:entrou') - quando('urgente:pediu')
console.log(`\n  o urgente esperou ${espera}ms`)
conferir('e esperou pouco (a passagem é rápida)', espera < 4000)

conferir('nenhum pedido ficou pendurado na fila',
  fs.existsSync(path.join(caixa, '.pncp-fila')) ? fs.readdirSync(path.join(caixa, '.pncp-fila')) : [], [])

console.log(`\n${ok} ok · ${falhou} falharam`)
try { fs.rmSync(caixa, { recursive: true, force: true }) } catch { /* Windows às vezes segura */ }
process.exit(falhou ? 1 : 0)
