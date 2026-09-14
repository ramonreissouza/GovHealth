// scripts/radar/espiar-sessao.mjs — OLHA a sessão viva do steel SEM MEXER NELA.
//
// Existe porque o momento de capturar não é óbvio: o fornecedor termina o login, mas
// o Compras.gov.br ainda abre um popup de aviso e só então troca os cookies com o
// `cnetmobile`. Capturar cedo demais devolve "não foi possível capturar a sessão" —
// e o cliente refaz o login à toa.
//
// É SÓ LEITURA: lista as abas, as URLs e os cookies. Não navega, não fecha aba, não
// limpa nada. Rodar enquanto a pessoa está logada é seguro.
//
//   node scripts/radar/espiar-sessao.mjs

import { chromium } from 'playwright'
import { cdpUrlDaSessaoViva } from './steel.mjs'

const AUTH = /Session_Gov_Br|Govbrid|GovbrUid|TSPD|\.ASPXAUTH|JSESSIONID|ASP\.NET_SessionId/i

const cdp = await cdpUrlDaSessaoViva()
console.log(`CDP: ${cdp}`)

const browser = await chromium.connectOverCDP(cdp)
const ctx = browser.contexts()[0]
if (!ctx) {
  console.log('sem contexto — o navegador não tem sessão aberta')
  await browser.close()
  process.exit(0)
}

console.log('\n--- abas ---')
for (const [i, p] of ctx.pages().entries()) {
  let titulo = ''
  try { titulo = await p.title() } catch {}
  console.log(`  [${i}] ${p.url()}`)
  if (titulo) console.log(`      ${titulo}`)
}

const cookies = await ctx.cookies()
const porDominio = new Map()
for (const c of cookies) porDominio.set(c.domain, (porDominio.get(c.domain) ?? 0) + 1)

console.log(`\n--- cookies: ${cookies.length} ---`)
for (const [d, n] of [...porDominio].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${d}`)

const auth = cookies.filter((c) => AUTH.test(c.name))
console.log(`\n--- de AUTENTICAÇÃO: ${auth.length} ---`)
for (const c of auth) console.log(`  ${c.name} @ ${c.domain}`)

const cnet = cookies.filter((c) => /cnetmobile|serpro/i.test(c.domain))
console.log(`\n--- no domínio que o monitor lê (cnetmobile/serpro): ${cnet.length} ---`)
for (const c of cnet) console.log(`  ${c.name} @ ${c.domain}`)

console.log(
  `\nveredito: ${auth.length > 0 ? 'HÁ sessão autenticada' : 'ainda NÃO há cookie de autenticação'}` +
    ` · cnetmobile ${cnet.some((c) => AUTH.test(c.name)) ? 'JÁ trocou' : 'ainda não trocou'}`,
)

await browser.close()
