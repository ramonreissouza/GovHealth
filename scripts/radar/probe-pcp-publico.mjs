// scripts/radar/probe-pcp-publico.mjs — PROVA DE CONCEITO: ler o chat do PCP SEM login.
// O PCP publica cada processo em /processos/{uf}/{orgao}/{processo} de forma PÚBLICA.
// A seção "Andamento do processo" traz as mensagens do pregoeiro (o mesmo chat da
// sessão), e "Documentos" traz a "Ata Final" (chat completo). Nada disso exige conta.
//
// Uso: node scripts/radar/probe-pcp-publico.mjs [urlPublica]
// Sem argumento, usa um processo de SAÚDE público conhecido.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extrairMensagensHeuristica } from './connector-pcp.mjs'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.calibra')
fs.mkdirSync(DIR, { recursive: true })

const URL_PADRAO =
  'https://www.portaldecompraspublicas.com.br/processos/sp/autarquia-municipal-de-saude-de-itapecerica-da-serra-1261/pe-pregao-eletronico-no-010-2024-2024-297860'
const alvo = process.argv[2] || URL_PADRAO

let chromium
try { ({ chromium } = await import('playwright')) }
catch { console.error('Playwright não instalado (npx playwright install chromium)'); process.exit(1) }

console.log(`→ Abrindo (SEM login): ${alvo}`)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
})
const page = await context.newPage()

try {
  await page.goto(alvo, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // Angular: dá um tempo para hidratar e tenta rolar até o andamento.
  await page.waitForTimeout(6000)
  try { await page.getByText(/andamento do processo/i).first().scrollIntoViewIfNeeded({ timeout: 5000 }) } catch {}
  await page.waitForTimeout(2000)

  const titulo = await page.title().catch(() => '')
  const temAndamento = await page.getByText(/andamento do processo/i).count().catch(() => 0)
  const temAtaFinal = await page.getByText(/ata final/i).count().catch(() => 0)

  const msgs = await extrairMensagensHeuristica(page).catch((e) => { console.error('extração falhou:', e.message); return [] })

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const base = path.join(DIR, `pcp-publico-${ts}`)
  try { await page.screenshot({ path: `${base}.png`, fullPage: true }) } catch {}
  try { fs.writeFileSync(`${base}.html`, await page.content()) } catch {}
  fs.writeFileSync(`${base}.json`, JSON.stringify({ url: alvo, titulo, temAndamento, temAtaFinal, total: msgs.length, mensagens: msgs }, null, 2))

  console.log(`\n=== RESULTADO (público, sem login) ===`)
  console.log(`título: ${titulo}`)
  console.log(`seção "Andamento do processo" presente: ${temAndamento > 0 ? 'SIM' : 'não'}`)
  console.log(`"Ata Final" listada em Documentos: ${temAtaFinal > 0 ? 'SIM' : 'não'}`)
  console.log(`mensagens extraídas (heurística): ${msgs.length}`)
  for (const m of msgs.slice(0, 15)) console.log(`  • [${m.autor ?? '—'}] ${String(m.texto).slice(0, 100)}${m.horario ? '  (' + m.horario + ')' : ''}`)
  console.log(`\ndump → ${base}.{png,html,json}`)
} catch (e) {
  console.error('falha:', e?.message ?? e)
  process.exitCode = 1
} finally {
  await browser.close()
}
