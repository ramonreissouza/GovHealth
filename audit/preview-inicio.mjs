// audit/preview-inicio.mjs — screenshot da landing local (desktop + mobile) p/ QA visual.
import { chromium } from 'playwright'
const B = process.env.PREVIEW_BASE || 'http://localhost:3011'
const browser = await chromium.launch()
try {
  // desktop
  const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const pd = await d.newPage()
  await pd.goto(`${B}/inicio`, { waitUntil: 'networkidle', timeout: 60000 })
  await pd.waitForTimeout(1500)
  await pd.screenshot({ path: 'audit/preview-desktop.png', fullPage: true })
  console.log('desktop ok')
  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const pm = await m.newPage()
  await pm.goto(`${B}/inicio`, { waitUntil: 'networkidle', timeout: 60000 })
  await pm.waitForTimeout(1500)
  await pm.screenshot({ path: 'audit/preview-mobile.png', fullPage: true })
  console.log('mobile ok')
} catch (e) { console.error('falha:', e.message); process.exitCode = 1 }
finally { await browser.close() }
