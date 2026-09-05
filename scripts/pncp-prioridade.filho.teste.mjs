// scripts/pncp-prioridade.filho.teste.mjs — o piso de trabalho é da PISTA ou do PROCESSO?
//
// POR QUE ESTE TESTE EXISTE. Em 05/09/2026 a passagem falhou inteira em produção, e os
// dois testes que já existiam passaram sem reclamar. O mutirão de PE segurou a pista por
// 62 minutos enquanto uma sonda esperava na fila; ele nunca cedeu, e nenhuma das duas
// pontas registrou erro — a sonda dizia "espera 1... espera 50", o mutirão não dizia nada.
//
// A causa: quem varre é um FILHO spawnado por FATIA, e cada fatia durava ~5 min. O
// `trabalhandoDesde` nascia junto com o processo, então nenhum filho chegava aos 10 min
// do piso e `quemPedePassagem` devolvia null para todos. A pista trocava de processo a
// cada 5 min e o relógio do piso voltava para o zero junto com ela.
//
// O teste e2e anterior não pegava isso porque usava UM processo longo com a pista na mão
// — a topologia mais fácil, não a que roda em produção. Aqui a topologia é a real: um pai
// que segura a pista e uma sequência de filhos CURTOS que fazem o trabalho.
//
// O caso negativo (sem o carimbo) é metade do teste, e de propósito: ele prova que o teste
// sabe distinguir. Um teste que passa nas duas configurações não estaria testando nada.
//
// Uso: npm run pncp:fila:teste:filho     (sai 1 se falhar)

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const MOD = (f) => `file://${path.join(AQUI, f).replace(/\\/g, '/')}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Piso de 200ms e filho de 150ms: o filho SEMPRE morre antes do piso, que é a proporção
// de produção (fatia de ~5min contra piso de 10min) em escala de teste.
const PISO_MS = 200
const VIDA_FILHO_MS = 150
const FATIAS = 8

/** Roda o cenário inteiro e devolve os eventos. `carimbar` liga o PNCP_TRABALHANDO_DESDE. */
async function cenario(carimbar) {
  const caixa = fs.mkdtempSync(path.join(os.tmpdir(), 'pncp-filho-'))
  const AMBIENTE = {
    ...process.env,
    PNCP_FILA_POLL_MS: '50',
    PNCP_FILA_GRACA_MS: '150',
    PNCP_FILA_MIN_TRABALHO_MS: String(PISO_MS),
    PNCP_FILA_MEMO_MS: '10',
  }

  // O FILHO: vive pouco, confere a passagem no laço e sai com CODIGO_CEDER se alguém pediu.
  fs.writeFileSync(path.join(caixa, 'filho.mjs'), `
process.chdir(${JSON.stringify(caixa)})
const fila = await import(${JSON.stringify(MOD('pncp-prioridade.mjs'))})
const fs = (await import('node:fs')).default
const marcar = (n) => fs.appendFileSync('eventos.txt', n + ' ' + Date.now() + '\\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fim = Date.now() + ${VIDA_FILHO_MS}
while (Date.now() < fim) {
  if (fila.devoCeder(process.env.PNCP_DONO)) { marcar('filho:cedeu'); process.exit(fila.CODIGO_CEDER) }
  await sleep(20)
}
process.exit(0)
`)

  // O PAI: segura a pista e manda um filho por fatia, como o backfill-2025h1 faz.
  fs.writeFileSync(path.join(caixa, 'pai.mjs'), `
process.chdir(${JSON.stringify(caixa)})
const fila = await import(${JSON.stringify(MOD('pncp-prioridade.mjs'))})
const lock = await import(${JSON.stringify(MOD('pncp-lock.mjs'))})
const fs = (await import('node:fs')).default
const { spawn } = await import('node:child_process')
const marcar = (n) => fs.appendFileSync('eventos.txt', n + ' ' + Date.now() + '\\n')

lock.pegar('backfill-2025h1')
marcar('pai:pegou')

for (let i = 0; i < ${FATIAS}; i++) {
  const env = { ...process.env, PNCP_DONO: 'backfill-2025h1' }
  ${carimbar ? "env.PNCP_TRABALHANDO_DESDE = String(fila.trabalhandoDesdeMs())" : "/* sem carimbo: o bug de 05/09 */"}
  const code = await new Promise((res) => {
    const p = spawn(process.execPath, ['filho.mjs'], { cwd: ${JSON.stringify(caixa)}, env, stdio: 'ignore' })
    p.on('exit', (c) => res(c ?? 0))
  })
  if (code === fila.CODIGO_CEDER) {
    marcar('pai:cedeu')
    await fila.ceder('backfill-2025h1', { log: () => {} })
    marcar('pai:retomou')
    break
  }
}
marcar('pai:fim')
lock.soltar()
`)

  // O URGENTE: chega no meio e pede a vez, como a sonda fez.
  fs.writeFileSync(path.join(caixa, 'urgente.mjs'), `
process.chdir(${JSON.stringify(caixa)})
const fila = await import(${JSON.stringify(MOD('pncp-prioridade.mjs'))})
const lock = await import(${JSON.stringify(MOD('pncp-lock.mjs'))})
const fs = (await import('node:fs')).default
const marcar = (n) => fs.appendFileSync('eventos.txt', n + ' ' + Date.now() + '\\n')

marcar('urgente:pediu')
const pegou = await fila.esperarVez('sync-cobertura', { esperaMaxMin: 0.03, log: () => {} })
marcar('urgente:' + (pegou ? 'entrou' : 'DESISTIU'))
if (pegou) lock.soltar()
`)

  const rodar = (f) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(caixa, f)], { cwd: caixa, env: AMBIENTE, stdio: 'ignore' })
    p.on('exit', (c) => resolve(c ?? 1))
  })

  const pai = rodar('pai.mjs')
  await sleep(PISO_MS + 120) // deixa a PISTA passar do piso — mas nenhum filho, sozinho, passa
  const urgente = rodar('urgente.mjs')
  await Promise.all([pai, urgente])

  const bruto = fs.existsSync(path.join(caixa, 'eventos.txt'))
    ? fs.readFileSync(path.join(caixa, 'eventos.txt'), 'utf8').trim()
    : ''
  const eventos = bruto ? bruto.split('\n').map((l) => l.split(' ')[0]) : []
  try { fs.rmSync(caixa, { recursive: true, force: true }) } catch { /* Windows às vezes segura */ }
  return eventos
}

let ok = 0
let falhou = 0
const conferir = (nome, real, esperado = true) => {
  if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome} — esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`) }
}

console.log('\n── COM o carimbo: o filho herda o relógio da pista ──')
const com = await cenario(true)
for (const e of com) console.log(`  ${e}`)
conferir('o pai pegou a pista', com.includes('pai:pegou'))
conferir('um filho percebeu o pedido e cedeu', com.includes('filho:cedeu'))
conferir('o pai entendeu a saída como passagem', com.includes('pai:cedeu'))
conferir('o urgente ENTROU', com.includes('urgente:entrou'))
conferir('o urgente entrou antes de o pai acabar as fatias', com.indexOf('urgente:entrou') < com.indexOf('pai:fim'))
conferir('o pai RETOMOU (cessão é pausa)', com.includes('pai:retomou'))

console.log('\n── SEM o carimbo: reprodução do bug de 05/09/2026 ──')
const sem = await cenario(false)
for (const e of sem) console.log(`  ${e}`)
conferir('nenhum filho cede — cada um reinicia o piso do zero', !sem.includes('filho:cedeu'))
// NÃO é "o urgente desiste": ele acaba entrando, só que TARDE — quando o pai termina
// sozinho. Foi exatamente assim em produção: a sonda não falhou, ela esperou 50 min e
// entrou quando o mutirão acabou. Esperar o trabalho inteiro é a falha; ninguém vê erro.
conferir('o urgente só entra DEPOIS de o pai acabar tudo',
  sem.indexOf('urgente:entrou') > sem.indexOf('pai:fim'))

console.log(`\n${ok} ok · ${falhou} falharam`)
if (falhou) {
  console.log('\nSe o bloco "SEM o carimbo" falhou, o teste perdeu o poder de distinguir:')
  console.log('ele passaria mesmo com o bug de volta. Conserte o teste antes de confiar nele.')
}
process.exit(falhou ? 1 : 0)
