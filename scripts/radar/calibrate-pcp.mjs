// scripts/radar/calibrate-pcp.mjs — HARNESS de calibração do PCP (etapa 2).
// Faz o login assistido no Portal de Compras Públicas, você navega até UMA
// licitação com chat aberto, e a ferramenta DESPEJA o que precisamos para fixar o
// conector: URL do chat, resultado da extração heurística, HTML e screenshot.
// Nada disso é enviado a lugar nenhum — fica em scripts/radar/.calibra/ para
// ajustarmos connector-pcp.mjs (chatUrlDoProcesso + seletores).
//
// Uso:
//   node scripts/radar/calibrate-pcp.mjs --login          # loga e salva a sessão local
//   node scripts/radar/calibrate-pcp.mjs --wait 180       # reaproveita a sessão salva
//   (após abrir, navegue até a licitação/sala de disputa; o dump sai ao fim do --wait)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturarSessaoPortal } from './capture.mjs'
import { extrairMensagensHeuristica } from './connector-pcp.mjs'
import { portalMeta } from './portais.mjs'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.calibra')
const SESSAO = path.join(DIR, 'pcp-session.json')
const META = portalMeta('pcp')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def }
const DO_LOGIN = process.argv.includes('--login')
const WAIT_S = Number(arg('wait', '150'))

fs.mkdirSync(DIR, { recursive: true })

async function obterSessao() {
  if (DO_LOGIN || !fs.existsSync(SESSAO)) {
    console.log(`→ Abrindo o ${META.nome} para login assistido (até ${WAIT_S}s)…`)
    const r = await capturarSessaoPortal('pcp', { waitS: WAIT_S })
    if (r.status !== 'ok' || !r.storageState) { console.error(`✗ login não concluído: ${r.status} — ${r.detalhe}`); process.exit(1) }
    fs.writeFileSync(SESSAO, r.storageState)
    console.log(`✓ sessão salva em ${SESSAO}`)
    return r.storageState
  }
  console.log(`→ Reaproveitando sessão salva (${SESSAO}). Use --login para refazer.`)
  return fs.readFileSync(SESSAO, 'utf8')
}

const storageState = await obterSessao()

let chromium
try { ({ chromium } = await import('playwright')) }
catch { console.error('Playwright não instalado (npx playwright install chromium)'); process.exit(1) }

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({ storageState: JSON.parse(storageState) })
const page = await context.newPage()
await page.goto(META.areaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

console.log(`\n=== CALIBRAÇÃO PCP ===`)
console.log(`Navegue MANUALMENTE até uma licitação com chat/sala de disputa aberta.`)
console.log(`Vou tirar o dump da página atual em ${WAIT_S}s (ou quando a URL parecer de um processo).`)

const inicio = Date.now()
let ultimaUrl = ''
let dumped = false
async function dump(motivo) {
  if (dumped) return
  dumped = true
  const url = page.url()
  const ts = new Date(inicio).toISOString().replace(/[:.]/g, '-')
  const base = path.join(DIR, `pcp-${ts}`)
  try { await page.screenshot({ path: `${base}.png`, fullPage: true }) } catch {}
  try { fs.writeFileSync(`${base}.html`, await page.content()) } catch {}
  let msgs = []
  try { msgs = await extrairMensagensHeuristica(page) } catch (e) { console.error('extração falhou:', e.message) }
  fs.writeFileSync(`${base}.json`, JSON.stringify({ url, motivo, mensagens: msgs }, null, 2))
  console.log(`\n✓ DUMP (${motivo}) → ${base}.{png,html,json}`)
  console.log(`  URL do chat: ${url}`)
  console.log(`  Mensagens extraídas (heurística): ${msgs.length}`)
  for (const m of msgs.slice(0, 8)) console.log(`   • [${m.autor ?? '—'}] ${String(m.texto).slice(0, 90)}${m.horario ? '  (' + m.horario + ')' : ''}`)
  console.log(`\nEnvie/mostre o pcp-*.json (e a URL) para fixarmos chatUrlDoProcesso + seletores no connector-pcp.mjs.`)
}

// Auto-dump quando a URL muda para algo que parece um processo; senão, no fim do --wait.
while (Date.now() - inicio < WAIT_S * 1000 && !dumped) {
  await page.waitForTimeout(3000)
  const url = page.url()
  if (url !== ultimaUrl) { ultimaUrl = url; console.log(`  url: ${url}`) }
  if (/processo|licita|sala|disput|chat|item/i.test(url) && url !== META.areaUrl) await dump('url-de-processo')
}
if (!dumped) await dump('timeout')

await browser.close()
process.exit(0)
