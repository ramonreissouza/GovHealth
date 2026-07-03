// audit/login-ui.mjs — reproduz o login pela UI (como o usuário faz) em prod.
import { chromium } from 'playwright'
const B = process.env.LOGIN_BASE || 'https://gov-health.vercel.app'
const EMAIL = process.env.LOGIN_EMAIL || 'pedro.moreira@techealth.com.br'
const SENHA = process.env.LOGIN_SENHA || 'pedrotec123'

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const erros = []
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
try {
  await page.goto(`${B}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', SENHA)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(6000)
  const url = page.url()
  const erroVisivel = await page.locator('text=incorretos').count().catch(() => 0)
  console.log('URL final:', url)
  console.log('mostrou "incorretos"?', erroVisivel > 0)
  console.log('logou?', !url.includes('/login'))
  if (erros.length) console.log('console errors:', erros.slice(0, 5))
} catch (e) { console.error('falha:', e.message) }
finally { await browser.close() }
