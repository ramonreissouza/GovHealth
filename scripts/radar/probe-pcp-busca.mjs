// probe-pcp-busca.mjs — descobre o ENDPOINT público de busca de processos do PCP.
// Abre /processos, digita um termo, e captura as chamadas XHR/fetch que a SPA faz.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.calibra')
fs.mkdirSync(DIR, { recursive: true })

let chromium
try { ({ chromium } = await import('playwright')) } catch { console.error('sem playwright'); process.exit(1) }

const termo = process.argv[2] || 'pregão eletrônico saúde'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' })
const page = await context.newPage()

const apis = []
page.on('request', (req) => {
  const u = req.url()
  if (/api|processo|search|busca|pesquisa/i.test(u) && !/\.(js|css|png|jpg|svg|woff2?)/i.test(u)) {
    apis.push({ method: req.method(), url: u, postData: req.postData()?.slice(0, 500) ?? null })
  }
})

try {
  await page.goto('https://www.portaldecompraspublicas.com.br/processos', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)
  // tenta digitar no campo de objeto e buscar
  try {
    const campo = page.getByPlaceholder(/objeto|pesquis|buscar/i).first()
    await campo.fill(termo, { timeout: 5000 })
    await page.keyboard.press('Enter')
  } catch (e) { console.log('não achei campo de busca:', e.message) }
  await page.waitForTimeout(6000)
} catch (e) { console.error('nav falhou:', e.message) }

const unicos = [...new Map(apis.map((a) => [a.method + a.url.split('?')[0], a])).values()]
fs.writeFileSync(path.join(DIR, 'pcp-apis.json'), JSON.stringify(apis, null, 2))
console.log(`\n=== ENDPOINTS candidatos (${unicos.length} únicos de ${apis.length}) ===`)
for (const a of unicos.slice(0, 40)) console.log(`${a.method}  ${a.url}${a.postData ? '\n   body: ' + a.postData : ''}`)
await browser.close()
