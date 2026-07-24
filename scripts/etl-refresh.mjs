// scripts/etl-refresh.mjs — REFRESH INCREMENTAL (a cada 3 dias) do ETL do PNCP.
//
// Diferente do etl-overnight (scan histórico de 12 meses com cap por UF), este
// pega só a janela RECENTE (default 21 dias) em TODAS as 27 UFs, SEM cap, para
// capturar as contratações de saúde novas/atualizadas desde o último refresh.
// É idempotente (UPSERT): contratos já no banco são pulados barato (jaProcessada).
//
// Janela de 21 dias cobre a cadência de 3 dias com folga ampla p/ publicações
// atrasadas do PNCP. Checkpoint é isolado por janela (--dias), então não conflita
// com o scan histórico.
//
// ORDEM DAS UFs: dos MAIORES estados (mais contratações de saúde) para os menores,
// então uma interrupção preserva primeiro o que mais importa (SP, RJ, MG…).
//
// Uso:  node scripts/etl-refresh.mjs
//   Ajuste fino por env: ETL_DIAS=21  ETL_DELAY=120  ETL_UF=SP,RJ,...
//
// Pensado para rodar via Windows Task Scheduler a cada 3 dias.

import { spawn } from 'node:child_process'

// 27 UFs, priorizadas dos maiores estados para os menores (economia/volume de saúde).
const UF = process.env.ETL_UF ?? 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR'
const DIAS = process.env.ETL_DIAS ?? '21'
const DELAY = process.env.ETL_DELAY ?? '120'
const NOCAP = '99999999' // sem teto: pega tudo que for saúde na janela
const ARGS = ['scripts/etl-pncp.mjs', `--uf=${UF}`, `--dias=${DIAS}`, `--max=${NOCAP}`, `--delay=${DELAY}`]
const MAX_TENTATIVAS = 100

const ts = () => new Date().toLocaleString('pt-BR')
function rodar() {
  return new Promise((resolve) => {
    const p = spawn('node', ARGS, { stdio: 'inherit' })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

console.log(`[refresh] início ${ts()} — janela=${DIAS}d UFs=${UF.split(',').length} delay=${DELAY}ms`)
let tentativa = 0
while (tentativa < MAX_TENTATIVAS) {
  tentativa++
  console.log(`\n=== [refresh] tentativa ${tentativa}/${MAX_TENTATIVAS} — ${ts()} ===`)
  const code = await rodar()
  if (code === 0) { console.log(`\n[refresh] ✓ concluído com sucesso em ${ts()}.`); break }
  if (tentativa >= MAX_TENTATIVAS) { console.log('\n[refresh] limite de tentativas atingido — rode de novo para continuar (retoma pelo checkpoint).'); break }
  console.log(`[refresh] saiu com código ${code}. Retomando em 30s (checkpoint preserva o progresso)…`)
  await new Promise((r) => setTimeout(r, 30000))
}
