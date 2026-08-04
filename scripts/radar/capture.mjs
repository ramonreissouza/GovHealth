// scripts/radar/capture.mjs — núcleo compartilhado da CAPTURA DE SESSÃO gov.br.
// Usado tanto pelo one-shot (connect.mjs) quanto pelo daemon (connect-service.mjs).
// Abre um navegador REAL na página do gov.br/Compras.gov.br, espera o login humano
// (CPF, senha, 2FA, CAPTCHA — tudo no domínio oficial) e devolve o storage_state.
// Nenhuma senha passa por nós.

import crypto from 'node:crypto'
import { portalMeta } from './portais.mjs'

export const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/acompanhamento'

/** Cifra com AES-256-GCM (mesma convenção de src/lib/radar/crypto.ts): iv:tag:ct base64. */
export function encrypt(keyHex, plain) {
  const key = Buffer.from(keyHex.trim(), 'hex')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

// Cookies que NÃO provam sessão: analytics, consentimento e balanceador. Medido em
// 2026-08-04: uma "conexão" foi dada como OK carregando só `_ga` e `_ga_623FPXHZ7K`
// do serpro.gov.br — nenhum login tinha acontecido. Ver sessaoTemCredencial().
const COOKIE_IRRELEVANTE = /^(_ga|_gid|_gat|_gcl|_fbp|_hj|__utm|OptanonConsent|OptanonAlertBoxClosed|cookie[-_]?consent|AWSALB|AWSALBCORS|__cf|_pk_)/i

/**
 * A sessão capturada carrega ALGUMA credencial de verdade?
 *
 * O detector `logado` de cada portal olha URL/conteúdo, e isso é frágil em SPA: o
 * Compras.gov.br é Angular e serve HTTP 200 com um HTML vazio na própria URL da área
 * logada — o app só decide redirecionar para o gov.br depois de carregar. Resultado:
 * a URL "parecia" logada e a captura era declarada OK sem sessão nenhuma, deixando o
 * conector VERDE sem ler nada — exatamente o falso "ok" que o Radar não pode dar.
 * Este teste é a rede de segurança, e é portal-agnóstico: exige pelo menos um cookie
 * que não seja de analytics/consentimento, ou qualquer entrada de localStorage
 * (SPAs guardam o token aí).
 */
export function sessaoTemCredencial(storageStateJson) {
  let s
  try { s = JSON.parse(storageStateJson) } catch { return false }
  const cookiesUteis = (s.cookies ?? []).filter((c) => !COOKIE_IRRELEVANTE.test(c.name ?? ''))
  const temLocal = (s.origins ?? []).some((o) => (o.localStorage ?? []).length > 0)
  return cookiesUteis.length > 0 || temLocal
}

/**
 * Captura de sessão PORTAL-AGNÓSTICA: abre a página de login do portal informado e
 * aguarda o login humano; ao detectar `logado`, devolve o storage_state.
 * @param {string} conectorId  id do portal (ver scripts/radar/portais.mjs)
 * @returns {{ status:'ok'|'sessao_expirada'|'captcha_2fa'|'portal_indisponivel'|'falha', detalhe:string, storageState?:string }}
 */
export async function capturarSessaoPortal(conectorId, { waitS = 300, onAbrir } = {}) {
  const meta = portalMeta(conectorId)
  let chromium
  try { ({ chromium } = await import('playwright')) }
  catch { return { status: 'falha', detalhe: 'Playwright não instalado (npx playwright install chromium)' } }

  let browser
  try {
    browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()
    const page = await context.newPage()
    if (onAbrir) { try { await onAbrir() } catch { /* ignore */ } }
    // Abre a área autenticada; se a sessão não existe, o portal cai no login.
    await page.goto(meta.areaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

    // Logado = detector do portal responde verdadeiro, estável por 2 checagens.
    const deadline = Date.now() + waitS * 1000
    let estavel = 0
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000)
      const url = page.url()
      const conteudo = (await page.content().catch(() => '')).toLowerCase()
      if (meta.logado({ url, conteudo })) { estavel++; if (estavel >= 2) break } else estavel = 0
    }

    const url = page.url()
    const conteudo = (await page.content().catch(() => '')).toLowerCase()
    if (!meta.logado({ url, conteudo })) {
      await browser.close()
      return { status: 'sessao_expirada', detalhe: `Login no ${meta.nome} não concluído dentro do tempo — tente novamente` }
    }
    const storageState = JSON.stringify(await context.storageState())
    await browser.close()
    // Rede de segurança contra falso "ok" (ver sessaoTemCredencial): o detector do
    // portal pode acertar a URL e ainda assim não haver sessão nenhuma.
    if (!sessaoTemCredencial(storageState)) {
      return {
        status: 'sessao_expirada',
        detalhe: `A janela do ${meta.nome} não terminou com uma sessão válida (nenhum cookie/token de login) — refaça a conexão e conclua o login`,
      }
    }
    return { status: 'ok', detalhe: `sessão capturada via login no ${meta.nome}`, storageState }
  } catch (e) {
    try { if (browser) await browser.close() } catch { /* ignore */ }
    const msg = String(e?.message ?? e).slice(0, 180)
    if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) return { status: 'portal_indisponivel', detalhe: msg }
    return { status: 'falha', detalhe: msg }
  }
}

/** Compatibilidade: captura do Compras.gov.br (gov.br) — usa o fluxo genérico. */
export function capturarSessaoGovbr(opts = {}) {
  return capturarSessaoPortal('comprasgov', opts)
}
