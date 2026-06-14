// scripts/etl-overnight.mjs — Lote OVERNIGHT (opção 2) resiliente.
//
// Roda o ETL nas 8 UFs de maior volume com janela maior e reinicia
// automaticamente em caso de queda (rede, rate-limit, sono do PC),
// retomando pelo checkpoint sem reprocessar.
//
// Uso:  npm run etl:overnight
//   (rode SOMENTE depois que a amostra terminar, para não dobrar a carga)
//
// Ajuste fino por env (opcional):
//   ETL_UF=SP,MG,...   ETL_MESES=12   ETL_MAX=1500   ETL_DELAY=250

import { spawn } from 'node:child_process'

const UF = process.env.ETL_UF ?? 'SP,MG,RJ,BA,CE,PR,PE,RS'
const MESES = process.env.ETL_MESES ?? '12'
const MAX = process.env.ETL_MAX ?? '1500'
const DELAY = process.env.ETL_DELAY ?? '250'
const ARGS = ['scripts/etl-pncp.mjs', `--uf=${UF}`, `--meses=${MESES}`, `--max=${MAX}`, `--delay=${DELAY}`]
const MAX_TENTATIVAS = 30

const ts = () => new Date().toLocaleString('pt-BR')
function rodar() {
  return new Promise((resolve) => {
    const p = spawn('node', ARGS, { stdio: 'inherit' })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

console.log(`[overnight] início ${ts()} — UFs=${UF} meses=${MESES} max/UF=${MAX} delay=${DELAY}ms`)
let tentativa = 0
while (tentativa < MAX_TENTATIVAS) {
  tentativa++
  console.log(`\n=== [overnight] tentativa ${tentativa}/${MAX_TENTATIVAS} — ${ts()} ===`)
  const code = await rodar()
  if (code === 0) { console.log(`\n[overnight] ✓ ETL concluído com sucesso em ${ts()}.`); break }
  if (tentativa >= MAX_TENTATIVAS) { console.log('\n[overnight] limite de tentativas atingido — rode de novo para continuar (retoma pelo checkpoint).'); break }
  console.log(`[overnight] ETL saiu com código ${code}. Retomando em 30s (checkpoint preserva o progresso)…`)
  await new Promise((r) => setTimeout(r, 30000))
}
