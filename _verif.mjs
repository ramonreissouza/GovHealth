import { chromium } from 'playwright'
const URL='https://gov-health.vercel.app'
const b = await chromium.launch()
const pg = await (await b.newContext({ viewport:{width:1500,height:950} })).newPage()
await pg.goto(`${URL}/login`, {waitUntil:'domcontentloaded'})
await pg.fill('input[type=email]', process.env.U)
await pg.fill('input[type=password]', process.env.P)
await pg.click('button[type=submit]')
await pg.waitForURL(/dashboard|oportunidades|inicio/, {timeout:60000}).catch(()=>{})
console.log('login →', pg.url())

// 1) Copiloto: data de hoje
await pg.goto(`${URL}/copiloto`, {waitUntil:'domcontentloaded'})
await pg.waitForTimeout(2500)
const ta = pg.locator('textarea').first()
await ta.fill('Que dia e hoje? Existem editais de 2026 na base?')
await pg.keyboard.press('Enter')
await pg.waitForTimeout(25000)
const txt = await pg.locator('main').innerText()
console.log('--- COPILOTO ---')
console.log(txt.split('\n').filter(l=>l.trim()).slice(-14).join('\n').slice(0,1200))
await pg.screenshot({path:'_v-copiloto.png'})

// 2) Radar de Verba: abrir um lead
await pg.goto(`${URL}/radar-verba`, {waitUntil:'domcontentloaded'})
await pg.waitForTimeout(9000)
const linha = pg.locator('tbody tr').first()
if (await linha.count()) {
  await linha.click()
  await pg.waitForTimeout(12000)
  const aside = await pg.locator('div.absolute.right-0').innerText().catch(()=> '(sem painel)')
  console.log('--- RADAR DE VERBA (detalhe) ---')
  console.log(aside.slice(0,1400))
  await pg.screenshot({path:'_v-verba.png'})
} else console.log('sem emendas na tabela')
await b.close()
