// scripts/backfill-antigos.mjs — recupera o passado da base, na ordem que custa menos.
//
// Duas etapas encadeadas, e a ordem NÃO é arbitrária:
//
//   1) VALORES — 20.068 contratações desde jan/2025 sem valor nenhum, concentradas em
//      7 meses que o enriquecedor nunca varreu. Usa o endpoint de LISTA (50 por
//      página), que não sofre o estrangulamento do de detalhe: ~2.700 pedidos por mês.
//
//   2) ITENS — o corte por valor do backfill-itens.
//
// Valores PRIMEIRO porque hoje 36.897 das contratações sem itens não têm valor para
// ser priorizadas. Se a etapa 2 rodasse antes, elas ficariam de fora do corte por
// valor sem ninguém perceber — e só reapareceriam numa varredura completa de 110h.
//
// Uso:
//   node scripts/backfill-antigos.mjs                 (valores + itens >= R$ 10 mi)
//   node scripts/backfill-antigos.mjs --min=1000000   (valores + itens >= R$ 1 mi)
//   node scripts/backfill-antigos.mjs --so-itens      (pula os valores)

import { spawn } from 'node:child_process'
import { soltar, soltarNaSaida } from './pncp-lock.mjs'
import { esperarVez, limparNaSaida } from './pncp-prioridade.mjs'

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d }
const MIN = arg('min', '10000000')
const SO_ITENS = process.argv.includes('--so-itens')

// Os 7 meses medidos em 23/08/2026 (contratações sem valor algum):
// nov/25 6.398 · abr/25 5.152 · fev/25 2.198 · out/25 2.113 · mar/26 1.983 · dez/25 1.312 · set/25 863
const MESES = ['2025-11', '2025-04', '2025-02', '2025-10', '2026-03', '2025-12', '2025-09']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ts = () => new Date().toLocaleString('pt-BR')
const log = (m) => console.log(`[antigos] ${ts()} ${m}`)

function rodar(args) {
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: 'inherit' })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

// ── pega a pista uma vez para as duas etapas ────────────────────────────────
// Sem teto de espera de propósito: é mutirão manual, quem rodou quer que rode.
limparNaSaida()
await esperarVez('backfill-antigos', { log })
soltarNaSaida()
log(`pista tomada — início`)

// ── etapa 1: valores ────────────────────────────────────────────────────────
if (!SO_ITENS) {
  for (const mes of MESES) {
    log(`valores: ${mes}`)
    const code = await rodar(['scripts/etl-enriquecer.mjs', `--de=${mes}`, `--ate=${mes}`])
    if (code !== 0) log(`valores: ${mes} saiu com código ${code} — seguindo para o próximo`)
  }
  log('valores: 7 meses concluídos')
}

// ── etapa 2: itens (já com os valores novos no lugar) ───────────────────────
const ORCAMENTO = arg('orcamento', '0')
log(`itens: corte >= R$ ${Number(MIN).toLocaleString('pt-BR')}`
  + (Number(ORCAMENTO) ? ` (teto de ${ORCAMENTO}min)` : ''))
const code = await rodar(['scripts/backfill-itens.mjs', `--min=${MIN}`, `--orcamento=${ORCAMENTO}`, '--sem-lock'])
log(`itens: encerrado com código ${code}`)

soltar()
log('FIM — pista liberada')
