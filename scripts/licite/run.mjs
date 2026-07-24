// scripts/licite/run.mjs — ORQUESTRADOR do coletor Licitações-e (BB).
// Varre (UF × situação aberta), resolve CAPTCHA via OCR grátis (retry), filtra saúde
// e grava em `contratacoes` (fonte='licitacoes-e'). Roda no PC do dono via Task
// Scheduler (como o ETL do PNCP) — NÃO na Vercel (precisa de navegador real).
//
// Uso:  node scripts/licite/run.mjs            (ou npm run licite:sync)
//   Env: LICITE_UF=SP,DF,MG   LICITE_SITUACOES=2,3,4,5   LICITE_DELAY=1500
//
// Observação: contorna o CAPTCHA do portal do BB via OCR local. Uso sob sua
// responsabilidade (ver termos de uso do Licitações-e).

import fs from 'node:fs'
import { chromium } from 'playwright'
import { buscar, criarSolver } from './collect.mjs'
import { novoDb, upsertLicitacoes } from './db.mjs'
import { isSaude } from '../saude-filter.mjs'

function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* noop */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada (.env.local).'); process.exit(1) }

const UFS = (process.env.LICITE_UF ?? 'SP,MG,RJ,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const SITUACOES = (process.env.LICITE_SITUACOES ?? '2,3,4,5').split(',').map((s) => s.trim()).filter(Boolean) // publicada, acolhimento, abertura, propostas abertas
const DELAY = Number(process.env.LICITE_DELAY ?? 1500)
const ts = () => new Date().toLocaleString('pt-BR')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log(`[licite] início ${ts()} — UFs=${UFS.length} situações=${SITUACOES.join(',')}`)

const ocr = await criarSolver()
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36', locale: 'pt-BR' })
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept().catch(() => {}))
const db = novoDb(); await db.connect()

let totBruto = 0, totSaude = 0, totGrav = 0, falhas = 0
const vistosNaRodada = new Set() // dedup entre situações/UF na mesma execução

for (const uf of UFS) {
  for (const situacao of SITUACOES) {
    try {
      const { ok, tentativas, linhas } = await buscar(page, ocr, { uf, situacao })
      const saude = linhas.filter((l) => isSaude(l.objeto) && !vistosNaRodada.has(l.numero))
      saude.forEach((l) => vistosNaRodada.add(l.numero))
      const grav = saude.length ? await upsertLicitacoes(db, saude) : 0
      totBruto += linhas.length; totSaude += saude.length; totGrav += grav
      console.log(`  ${uf}/sit${situacao}: ok=${ok} tent=${tentativas} bruto=${linhas.length} saúde=${saude.length} grav=${grav}`)
    } catch (e) {
      falhas++
      console.warn(`  ${uf}/sit${situacao}: FALHA ${String(e.message).slice(0, 60)}`)
    }
    await sleep(DELAY)
  }
}

console.log(`\n[licite] fim ${ts()} — bruto=${totBruto} · saúde=${totSaude} · gravadas=${totGrav} · falhas=${falhas}`)
await ocr.fechar(); await db.end(); await browser.close()
