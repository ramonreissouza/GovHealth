// scripts/shots/capture.mjs
// Captura prints atualizados da plataforma para a landing (/inicio), em 2x (retina).
//
// Uso:
//   node scripts/shots/capture.mjs                          (dev local, todos os prints)
//   node scripts/shots/capture.mjs https://gov-health.vercel.app
//   node scripts/shots/capture.mjs <base> radar-chat,precos  (só alguns)
//
// Pré-req: SHOTS_EMAIL e SHOTS_SENHA no .env.local (conta com plano Empresa, para
// que Radar de Chat e Preços Ref. rendam). 2FA precisa estar desligado (padrão).
//
// ⚠️ IDENTIDADE NEUTRA — a razão de existir do passo `neutralizar()`.
// A conta de captura é uma conta de APRESENTAÇÃO com nome de empresa real
// ("Siemens Healthineers"). O chip do rodapé da sidebar mostra esse nome e o
// e-mail, e o print vai para a home pública — ou seja, a landing publicava o
// nome de uma empresa real como se fosse cliente. Antes de cada screenshot,
// trocamos o chip por uma identidade genérica. Isso não maquia o produto: os
// dados, contadores e telas são os de verdade; só o dono da conta fica anônimo.
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const BASE = process.argv[2] || 'http://localhost:3000'
const FILTRO = (process.argv[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const OUT = path.resolve('public/shots')
fs.mkdirSync(OUT, { recursive: true })

// Credenciais fora do código: ficam no .env.local (gitignored). Estavam
// embutidas aqui, o que colocava a senha de uma conta de produção no git.
const env = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : ''
const le = (k) => process.env[k] ?? env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
const EMAIL = le('SHOTS_EMAIL')
const SENHA = le('SHOTS_SENHA')
if (!EMAIL || !SENHA) {
  console.error('Defina SHOTS_EMAIL e SHOTS_SENHA no .env.local (conta plano Empresa, 2FA off).')
  process.exit(1)
}

const VIEWPORT = { width: 1440, height: 900 }

// Identidade genérica que entra no lugar da conta de apresentação.
const IDENTIDADE = { nome: 'Comercial', email: 'voce@suaempresa.com.br' }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
const page = await ctx.newPage()

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', SENHA)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 45000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
}

/** Anonimiza o chip da conta e tira o widget de suporte (polui print de venda). */
async function neutralizar(idt) {
  await page.evaluate(({ nome, email }) => {
    // O chip não tem seletor próprio: acho o <div> cujo texto é exatamente o
    // e-mail logado e reescrevo ele + o irmão de cima (o nome).
    for (const el of document.querySelectorAll('div')) {
      if (el.children.length === 0 && /@/.test(el.textContent ?? '') && (el.textContent ?? '').trim().length < 60) {
        const pai = el.parentElement
        const nomeEl = pai?.firstElementChild
        if (nomeEl && nomeEl !== el) nomeEl.textContent = nome
        el.textContent = email
      }
    }
    // Avatar de iniciais segue a identidade nova.
    for (const el of document.querySelectorAll('div.rounded-full')) {
      const t = (el.textContent ?? '').trim()
      if (t.length >= 1 && t.length <= 2 && el.children.length === 0) el.textContent = nome.slice(0, 1).toUpperCase()
    }
    // Widget de feedback ("Ajuda", canto inferior direito) — polui print de venda.
    document.querySelectorAll('.fixed.bottom-5.right-5').forEach((n) => n.remove())
    // Atalhos "MEU PORTFÓLIO" da tela de Preços: são as MARCAS da conta de
    // apresentação (MAGNETOM, SOMATOM, ACUSON…), que identificam a empresa tanto
    // quanto o nome no chip. Saem junto.
    // (o texto no DOM é "Meu Portfólio" — a caixa alta do print vem do CSS)
    for (const el of document.querySelectorAll('span')) {
      if ((el.textContent ?? '').trim().toLowerCase() === 'meu portfólio') { el.parentElement?.remove(); break }
    }
    // Painel "Meu território" do /mapa: é a configuração de UF da conta e, como os
    // contadores por região carregam depois, o print pega os esqueletos e parece
    // tela quebrada. Sai — o mapa de calor é a imagem.
    for (const el of document.querySelectorAll('div, span, h2, h3')) {
      if ((el.textContent ?? '').trim() === 'Meu território') {
        (el.closest('div.absolute') ?? el.parentElement?.parentElement)?.remove()
        break
      }
    }
  }, idt)
}

async function shot(nome, url, { waitFor, delay = 2500, clique, apos = 0 } = {}) {
  if (FILTRO.length && !FILTRO.includes(nome)) return
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(delay)
  if (clique) {
    await page.click(clique, { timeout: 8000 }).catch((e) => console.warn(`  (clique falhou: ${clique} — ${String(e.message).split('\n')[0]})`))
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(apos)
  }
  await neutralizar(IDENTIDADE)
  const dest = path.join(OUT, `${nome}.png`)
  await page.screenshot({ path: dest, clip: { x: 0, y: 0, ...VIEWPORT } })
  console.log('OK', `${nome}.png`, '→', dest)
}

console.log('Login…', EMAIL, '@', BASE)
await login()
console.log('URL após login:', page.url())
if (page.url().includes('/login')) {
  console.error('Login não passou — confira SHOTS_EMAIL/SHOTS_SENHA e se o 2FA está off.')
  await browser.close()
  process.exit(1)
}

// A conta de captura tem território (3 UFs) no setup, e o dashboard abre filtrado
// por ele — print de venda tem que mostrar cobertura nacional, então clico "Brasil".
await shot('dashboard', '/', { delay: 4000, clique: 'button:has-text("Brasil (todos)")', apos: 4000 })
await shot('mapa', '/mapa', { waitFor: '.mapboxgl-canvas', delay: 8000 })
await shot('licitacoes', '/oportunidades', { delay: 4500 })
// Preços abre em estado vazio: sem uma busca, o print não mostra nada.
// Equipamento e não medicamento de propósito: em "Dipirona" o cartão PREÇO MÉDIO
// vem R$ 194K contra mediana R$ 1,00 — a média é comida por linha com valor
// unitário preenchido como total, e o print anunciaria a estatística quebrada.
await shot('precos', '/precos', { delay: 2000, clique: 'button:text-is("Ultrassom")', apos: 6000 })
// Não vai para a landing hoje: nesta conta o Radar de Chat tem 0 mensagem
// capturada e 1 conector com falha — o print mostraria a função sem funcionar.
await shot('radar-chat', '/radar', { delay: 4500 })

await browser.close()
console.log('\nPrints atualizados em public/shots/.')
