// scripts/etl-parallel.mjs — CATALOGAÇÃO NACIONAL EM PARALELO POR ESTADO (overnight).
//
// Divide as 27 UFs em N "lanes" (faixas) que rodam ao MESMO tempo, cada uma com seu
// próprio processo etl-pncp e auto-restart por checkpoint. Diferente do etl-overnight
// (que varre as UFs em sequência num processo só) e do etl-refresh (sequencial, 1 lane).
//
// Robustez p/ madrugada:
//  • cada lane reinicia sozinha se cair (rede/rate-limit/PNCP fora) — retoma pelo checkpoint;
//  • lanes independentes: a queda de uma não derruba as outras;
//  • largada escalonada (stagger) p/ não dar "thundering herd" no PNCP;
//  • etl-pncp já trata outage global (espera 60s e repete a MESMA página, sem perder dado).
//
// Uso:   node scripts/etl-parallel.mjs
//   Ajuste por env:
//     ETL_LANES=4                 (nº de faixas paralelas; +lanes = +rápido e +carga no PNCP)
//     ETL_DIAS=21                 (janela incremental; default) — OU ETL_MESES=12 p/ histórico
//     ETL_MAX=99999999            (teto por UF; default sem teto)
//     ETL_DELAY=300               (ms entre chamadas, por lane)
//     ETL_UF=SP,MG,...            (sobrepõe a lista das 27, ordem de volume)
//
// Pensado p/ rodar em background e segurar a noite. Idempotente/restartável.

import { spawn } from 'node:child_process'

// 27 UFs em ordem de volume (maiores primeiro) — a distribuição round-robin abaixo
// espalha os "pesados" entre as lanes p/ equilibrar a carga.
const UFS = (process.env.ETL_UF ?? 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const LANES = Math.max(1, Number(process.env.ETL_LANES ?? 4))
const DIAS = process.env.ETL_DIAS ?? (process.env.ETL_MESES ? null : '21')
const MESES = process.env.ETL_MESES ?? null
const MAX = process.env.ETL_MAX ?? '99999999' // sem teto por padrão: pega tudo de saúde na janela
const DELAY = process.env.ETL_DELAY ?? '300'
const MAX_TENTATIVAS = 200
const STAGGER_MS = 4000 // largada escalonada entre lanes

// Round-robin: lane i recebe UFs i, i+LANES, i+2*LANES… → pesados espalhados.
const faixas = Array.from({ length: LANES }, () => [])
UFS.forEach((uf, i) => faixas[i % LANES].push(uf))

const ts = () => new Date().toLocaleString('pt-BR')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function janelaArgs() {
  return MESES ? [`--meses=${MESES}`] : [`--dias=${DIAS}`]
}

function rodarEtl(ufSubset, laneId) {
  return new Promise((resolve) => {
    const args = ['scripts/etl-pncp.mjs', `--uf=${ufSubset.join(',')}`, ...janelaArgs(), `--max=${MAX}`, `--delay=${DELAY}`]
    const p = spawn('node', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

async function lane(laneId, ufSubset) {
  await sleep(laneId * STAGGER_MS) // largada escalonada
  console.log(`[lane ${laneId}] início ${ts()} — UFs=${ufSubset.join(',')}`)
  let tentativa = 0
  while (tentativa < MAX_TENTATIVAS) {
    tentativa++
    const code = await rodarEtl(ufSubset, laneId)
    if (code === 0) { console.log(`[lane ${laneId}] ✓ concluída em ${ts()} (${ufSubset.join(',')})`); return }
    console.log(`[lane ${laneId}] saiu code=${code} (tent ${tentativa}/${MAX_TENTATIVAS}) — retoma em 30s pelo checkpoint…`)
    await sleep(30000)
  }
  console.log(`[lane ${laneId}] ✗ atingiu ${MAX_TENTATIVAS} tentativas — rode de novo p/ continuar.`)
}

const janela = MESES ? `meses=${MESES}` : `dias=${DIAS}`
console.log(`[parallel] início ${ts()} — ${LANES} lanes · ${UFS.length} UFs · ${janela} · max/UF=${MAX} · delay=${DELAY}ms`)
faixas.forEach((f, i) => console.log(`  lane ${i}: ${f.join(',')}`))
await Promise.all(faixas.map((f, i) => lane(i, f)))
console.log(`\n[parallel] TODAS as lanes concluíram em ${ts()}.`)
