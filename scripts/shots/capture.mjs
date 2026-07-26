// scripts/shots/capture.mjs
// Captura prints atualizados da plataforma para a landing (/inicio).
// Loga numa conta demo Pro no dev local e salva public/shots/{dashboard,mapa}.png
// em 2x (retina). Uso: node scripts/shots/capture.mjs [baseUrl]
//
// Pré-req: dev server rodando (padrão http://localhost:3000) e conta demo semeada
// (scripts/seed-demo-contas.mjs). 2FA precisa estar desligado (padrão).
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const BASE = process.argv[2] || 'http://localhost:3000'
const EMAIL = 'siemens@govhealth.ai'
const SENHA = 'Siemens@2026'
const OUT = path.resolve('public/shots')
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORT = { width: 1440, height: 900 }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
const page = await ctx.newPage()

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', SENHA)
  await page.click('button[type="submit"]')
  // 2FA off → redireciona para / ; damos folga para o dashboard buscar dados.
  await page.waitForURL(`${BASE}/`, { timeout: 30000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
}

async function shot(url, file, { waitFor, delay = 2500 } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(delay)
  const dest = path.join(OUT, file)
  await page.screenshot({ path: dest, clip: { x: 0, y: 0, ...VIEWPORT } })
  console.log('OK', file, '→', dest)
}

console.log('Login…', EMAIL)
await login()
console.log('URL após login:', page.url())

await shot('/', 'dashboard.png', { delay: 3500 })
await shot('/mapa', 'mapa.png', { waitFor: '.mapboxgl-canvas', delay: 5000 })

await browser.close()
console.log('\nPrints atualizados em public/shots/.')
