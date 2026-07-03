// audit/shots.mjs — captura screenshots REAIS do produto (logado em produção)
// para a landing. Salva em public/shots/. Uso: node audit/shots.mjs
import { chromium, request } from 'playwright'
import path from 'node:path'

const BASE = process.env.SHOTS_BASE || 'https://gov-health.vercel.app'
const EMAIL = process.env.SHOTS_EMAIL || 'teste@govhealth.ai'
const SENHA = process.env.SHOTS_SENHA || 'Teste@2026'
const OUT = path.join('public', 'shots')

const paginas = [
  { rota: '/', arquivo: 'dashboard.png', espera: 3500 },
  { rota: '/mapa', arquivo: 'mapa.png', espera: 5000 },
  { rota: '/concorrentes-estado', arquivo: 'concorrentes.png', espera: 3500 },
]

// Login via API (CSRF + callback) → obtém o cookie de sessão (mais robusto que UI).
console.log('→ login (API) em', BASE, 'como', EMAIL)
const api = await request.newContext({ baseURL: BASE })
const { csrfToken } = await (await api.get('/api/auth/csrf')).json()
await api.post('/api/auth/callback/credentials', {
  form: { csrfToken, email: EMAIL, password: SENHA, json: 'true' },
})
const storageState = await api.storageState()
const temSessao = storageState.cookies.some((c) => /next-auth.session-token|__Secure-next-auth.session-token/.test(c.name))
console.log('  cookie de sessão presente?', temSessao)
if (!temSessao) { console.error('  ✗ login falhou — abortando'); process.exit(1) }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState })
const page = await ctx.newPage()
try {
  for (const p of paginas) {
    console.log('→', p.rota)
    await page.goto(`${BASE}${p.rota}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(p.espera)
    const dest = path.join(OUT, p.arquivo)
    await page.screenshot({ path: dest })
    console.log('  salvo', dest)
  }
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
