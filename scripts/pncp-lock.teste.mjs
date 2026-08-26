// scripts/pncp-lock.teste.mjs — o lock decide certo quem tem a pista?
//
// Existe porque o modo de falha deste módulo é INVISÍVEL: quando ele erra, ninguém
// recebe erro nenhum — dois processos simplesmente passam a bater no PNCP ao mesmo
// tempo, os dois degradam, e o log de cada um parece normal. Foi exatamente o que
// aconteceu em 26/08/2026: `estado()` conferia a IDADE do lock antes da VIDA do PID,
// então uma tarefa viva com orçamento de 30h perdia a pista na hora 20 e o processo
// seguinte entrava por cima dela. Vinte horas de coleta sem um aviso.
//
// Roda fora do repositório de propósito: o módulo resolve `.pncp-ocupado` por
// process.cwd(), então o diretório temporário mantém o lock de produção intocado.
//
// Uso: npm run pncp:lock:teste     (sai 1 se algum caso falhar)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pncp-lock.mjs')

// cwd isolado ANTES de importar: é no import que ARQUIVO é resolvido.
const caixa = fs.mkdtempSync(path.join(os.tmpdir(), 'pncp-lock-teste-'))
process.chdir(caixa)
const mod = await import(`file://${MODULO.replace(/\\/g, '/')}`)
const LOCK = path.join(caixa, '.pncp-ocupado')

let ok = 0, falhou = 0
const hAtras = (h) => new Date(Date.now() - h * 3600000).toISOString()
const minAtras = (m) => new Date(Date.now() - m * 60000).toISOString()

// `cru` escreve o texto como está — é o único jeito de testar lock ilegível, porque
// JSON.stringify('lixo') produz JSON VÁLIDO e cairia no ramo do PID, não no do parse.
function caso(nome, lock, esperado, cru = false) {
  fs.writeFileSync(LOCK, cru ? lock : JSON.stringify(lock))
  const e = mod.estado()
  const passou = e.ocupado === esperado
  console.log(`${passou ? 'ok   ' : 'FALHA'} ${nome} → ocupado=${e.ocupado}`
    + (e.motivo ? ` (${e.motivo})` : '') + (passou ? '' : ` — esperado ${esperado}`))
  passou ? ok++ : falhou++
  try { fs.unlinkSync(LOCK) } catch { /* o próprio estado() já apagou */ }
}

const VIVO = process.pid
const MORTO = 999999   // fora do alcance normal de PID: não existe

// O caso que quebrou em 26/08/2026, e a razão deste arquivo.
caso('legado vivo com 21h — antes era evicto na hora 20',
  { pid: VIVO, dono: 'backfill-antigos', desde: hAtras(21) }, true)
caso('legado vivo com 50h — passa até do teto de legado',
  { pid: VIVO, dono: 'antigo', desde: hAtras(50) }, false)
caso('legado com PID morto',
  { pid: MORTO, dono: 'antigo', desde: hAtras(1) }, false)

// Versão nova: o dono se anuncia, e o teto mede o SILÊNCIO, não a idade.
caso('anuncia, vivo, bateu há 2min', { pid: VIVO, dono: 'novo', desde: minAtras(2), anuncia: true }, true)
caso('anuncia, vivo, bateu há 29min', { pid: VIVO, dono: 'novo', desde: minAtras(29), anuncia: true }, true)
caso('anuncia, vivo, calado há 40min — PID reciclado é o caso que isto pega',
  { pid: VIVO, dono: 'novo', desde: minAtras(40), anuncia: true }, false)
caso('anuncia, morto', { pid: MORTO, dono: 'novo', desde: minAtras(1), anuncia: true }, false)
caso('relógio andou para trás', { pid: VIVO, dono: 'novo', desde: new Date(Date.now() + 7200000).toISOString(), anuncia: true }, false)
caso('lock ilegível', '{isto não é json', false, true)

// pegar() anuncia de verdade, e soltar() limpa.
mod.pegar('teste')
const escrito = JSON.parse(fs.readFileSync(LOCK, 'utf8'))
const anunciou = escrito.pid === process.pid && escrito.anuncia === true
console.log(`${anunciou ? 'ok   ' : 'FALHA'} pegar() escreve com anúncio (pid ${escrito.pid}, anuncia ${escrito.anuncia})`)
anunciou ? ok++ : falhou++

const meuLock = mod.estado()
const reconheceu = meuLock.ocupado && meuLock.dono === 'teste'
console.log(`${reconheceu ? 'ok   ' : 'FALHA'} estado() reconhece o lock recém-pego (dono ${meuLock.dono})`)
reconheceu ? ok++ : falhou++

mod.soltar()
const sumiu = !fs.existsSync(LOCK)
console.log(`${sumiu ? 'ok   ' : 'FALHA'} soltar() apaga o arquivo e para a batida`)
sumiu ? ok++ : falhou++

console.log(`\n${ok} ok · ${falhou} falha(s)`)
// Sair do diretório antes de apagá-lo: no Windows não se remove o cwd.
process.chdir(os.tmpdir())
try { fs.rmSync(caixa, { recursive: true, force: true }) } catch { /* sobra em tmp: inofensivo */ }
process.exit(falhou ? 1 : 0)
