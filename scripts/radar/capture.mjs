// scripts/radar/capture.mjs — núcleo compartilhado da CAPTURA DE SESSÃO gov.br.
// Usado tanto pelo one-shot (connect.mjs) quanto pelo daemon (connect-service.mjs).
// Abre um navegador REAL na página do gov.br/Compras.gov.br, espera o login humano
// (CPF, senha, 2FA, CAPTCHA — tudo no domínio oficial) e devolve o storage_state.
// Nenhuma senha passa por nós.

import crypto from 'node:crypto'
import { portalMeta } from './portais.mjs'
import { serializarSessaoRecortada, resumoDescarte } from './sessao-escopo.mjs'

export const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor'

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

/** Quantas vezes, no máximo, tentamos levar o usuário do SSO à área do portal. */
export const TENTATIVAS_AREA = 3

/**
 * Espera o login humano terminar. Separada de `capturarSessaoPortal` para ser testada
 * sem navegador (o relógio é injetável).
 *
 * Devolve `{ logado, erroNavegacao }`. `erroNavegacao` só vem preenchido quando o login
 * NÃO terminou e a última ida à área falhou por transporte — é o que permite dizer
 * `portal_indisponivel` em vez de culpar o usuário com `sessao_expirada`.
 *
 * @param {import('playwright').Page} page
 * @param {object} meta  entrada de portais.mjs
 * @param {{ deadlineMs: number, agora?: () => number, tentativasArea?: number }} opts
 */
export async function aguardarLogin(page, meta, { deadlineMs, agora = Date.now, tentativasArea = TENTATIVAS_AREA }) {
  let estavel = 0
  // A flag era marcada ANTES do `goto`, e o erro do `goto` era engolido. Um timeout
  // qualquer deixava o usuário parado na landing do SSO, sem nova tentativa pelos
  // ~900 s restantes, e a janela fechava dizendo "login não concluído" — culpando quem
  // tinha feito o login certo. Agora: marca só depois de dar certo, e tenta de novo
  // (poucas vezes) no próximo ciclo se não deu.
  let levadoAArea = false
  let tentativas = 0
  let erroNavegacao = null
  while (agora() < deadlineMs) {
    await page.waitForTimeout(3000)
    const url = page.url()
    const conteudo = (await page.content().catch(() => '')).toLowerCase()
    if (meta.logado({ url, conteudo })) { estavel++; if (estavel >= 2) return { logado: true, erroNavegacao: null }; continue }
    estavel = 0
    // Saiu do login mas ainda não está na área de trabalho: o SSO costuma devolver
    // numa landing, e os marcadores que o detector procura só existem na área. Só
    // depois que o login saiu de cena — navegar durante o 2FA interromperia o humano
    // no meio da autenticação.
    if (!levadoAArea && tentativas < tentativasArea && meta.emLogin && !meta.emLogin({ url }) && meta.areaUrl && url !== 'about:blank') {
      tentativas++
      try {
        await page.goto(meta.areaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        levadoAArea = true
        erroNavegacao = null
      } catch (e) {
        erroNavegacao = String(e?.message ?? e).slice(0, 180)
      }
    }
  }
  const url = page.url()
  const conteudo = (await page.content().catch(() => '')).toLowerCase()
  if (meta.logado({ url, conteudo })) return { logado: true, erroNavegacao: null }
  return { logado: false, erroNavegacao }
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

    // A TELA DE LOGIN DO PORTAL, não a área autenticada.
    //
    // Este arquivo abria `areaUrl` apostando que quem chega sem sessão é mandado para o
    // login. No Compras.gov.br isso é falso, e o próprio `portais.mjs` já documentava o
    // porquê desde 13/09/2026 — só que ninguém lia a `loginUrl` que ele definiu.
    //
    // O que o fornecedor via (medido em 18/09/2026, reproduzindo o caminho inteiro):
    //   1. a janela abria em /comprasnet-web/seguro/fornecedor;
    //   2. o portal respondia "Acesso não autorizado — tente realizar o acesso a partir
    //      do Compras.gov.br", porque o cnetmobile não aceita link direto;
    //   3. daí se chegava ao SSO do gov.br com `client_id=www.gov.br` — o login GENÉRICO
    //      do portal gov.br, não o do Compras.gov.br, que é `client_id=comprasnet.gov.br`;
    //   4. e esse fluxo recusava o CAPTCHA (ERL0000900) por mais correto que estivesse.
    //
    // Pelo caminho do portal (loginPortal.asp → perfil → "Entrar com Gov.br") o SSO
    // abre com `client_id=comprasnet.gov.br` e devolve a sessão que o conector precisa.
    const entrada = meta.loginUrl ?? meta.areaUrl
    await page.goto(entrada, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

    // Logado = detector do portal responde verdadeiro, estável por 2 checagens.
    const espera = await aguardarLogin(page, meta, { deadlineMs: Date.now() + waitS * 1000 })
    if (!espera.logado) {
      await browser.close()
      // Não chegou à área por TRANSPORTE (timeout, rede) — não é o usuário que não
      // logou. Dizer `sessao_expirada` aqui mandaria refazer um login que estava certo.
      if (espera.erroNavegacao) {
        return { status: 'portal_indisponivel', detalhe: `O ${meta.nome} não respondeu ao abrir a área depois do login (${TENTATIVAS_AREA} tentativas): ${espera.erroNavegacao}` }
      }
      return { status: 'sessao_expirada', detalhe: `Login no ${meta.nome} não concluído dentro do tempo — tente novamente` }
    }
    // RECORTE ANTES DE SAIR DAQUI. O que a função devolve é o que vai ser cifrado no
    // cofre — então é aqui, e não no chamador, que o cookie do Login Único tem de
    // morrer. Ver scripts/radar/sessao-escopo.mjs.
    const { json: storageState } = serializarSessaoRecortada(
      await context.storageState(), conectorId,
      { aoDescartar: (d) => console.log(`  [sessao] fora do escopo do ${conectorId}, descartado: ${resumoDescarte(d)}`) },
    )
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
