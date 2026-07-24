// scripts/radar/capture.mjs — núcleo compartilhado da CAPTURA DE SESSÃO gov.br.
// Usado tanto pelo one-shot (connect.mjs) quanto pelo daemon (connect-service.mjs).
// Abre um navegador REAL na página do gov.br/Compras.gov.br, espera o login humano
// (CPF, senha, 2FA, CAPTCHA — tudo no domínio oficial) e devolve o storage_state.
// Nenhuma senha passa por nós.

import crypto from 'node:crypto'

export const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/acompanhamento'

/** Cifra com AES-256-GCM (mesma convenção de src/lib/radar/crypto.ts): iv:tag:ct base64. */
export function encrypt(keyHex, plain) {
  const key = Buffer.from(keyHex.trim(), 'hex')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

/**
 * Abre o gov.br e aguarda o login. Retorna { status, detalhe, storageState }.
 * status ∈ ok | sessao_expirada | captcha_2fa | portal_indisponivel | falha.
 * `onAbrir` é chamado quando a janela abre (para o daemon marcar 'conectando').
 */
export async function capturarSessaoGovbr({ waitS = 300, onAbrir } = {}) {
  let chromium
  try { ({ chromium } = await import('playwright')) }
  catch { return { status: 'falha', detalhe: 'Playwright não instalado (npx playwright install chromium)' } }

  let browser
  try {
    browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()
    const page = await context.newPage()
    if (onAbrir) { try { await onAbrir() } catch { /* ignore */ } }
    await page.goto(ACOMPANHAMENTO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

    // Autenticado = saiu das telas de login (acesso.gov.br/sso/login) e está na
    // área segura do comprasnet-web, de forma estável por 2 checagens.
    const deadline = Date.now() + waitS * 1000
    let estavel = 0
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000)
      const url = page.url()
      const naArea = /comprasnet-web\/seguro/.test(url)
      const emLogin = /acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url)
      const conteudo = (await page.content().catch(() => '')).toLowerCase()
      if (/captcha|recaptcha|hcaptcha/.test(conteudo) && emLogin) { /* segue aguardando o humano resolver */ }
      if (naArea && !emLogin) { estavel++; if (estavel >= 2) break } else estavel = 0
    }

    const url = page.url()
    if (!/comprasnet-web\/seguro/.test(url) || /acesso\.gov\.br|sso\.|\/login/i.test(url)) {
      await browser.close()
      return { status: 'sessao_expirada', detalhe: 'Login não concluído dentro do tempo — tente novamente' }
    }
    const storageState = JSON.stringify(await context.storageState())
    await browser.close()
    return { status: 'ok', detalhe: 'sessão capturada via login no gov.br', storageState }
  } catch (e) {
    try { if (browser) await browser.close() } catch { /* ignore */ }
    const msg = String(e?.message ?? e).slice(0, 180)
    if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) return { status: 'portal_indisponivel', detalhe: msg }
    return { status: 'falha', detalhe: msg }
  }
}
