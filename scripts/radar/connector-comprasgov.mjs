// scripts/radar/connector-comprasgov.mjs — conector REAL do Compras.gov.br (Playwright).
// Lê o chat autenticado dos processos que o fornecedor acompanha. Roda no WORKER
// (fora da Vercel), agendado no Task Scheduler — nunca em rota serverless.
//
// MODELO SEM SENHA: usa SOMENTE a sessão capturada (storageState) pelo fluxo de
// captura assistida (scripts/radar/connect.mjs — login feito na página real do gov.br).
// Este conector NUNCA digita senha; se a sessão expirou/ausente, devolve
// 'sessao_expirada' e o fornecedor reconecta.
//
// IMPORTANTE (requisito 4.2 + ToS):
//  - Sessão expirada/ausente → 'sessao_expirada' (NUNCA finge "sem mensagens").
//  - Não tenta burlar CAPTCHA/2FA: detecta e devolve 'captcha_2fa' p/ intervenção.
//  - Os seletores de DOM abaixo são pontos de ajuste (o portal muda de tempos em
//    tempos); qualquer falha inesperada vira 'falha' e alarme na saúde do conector.

import { SIMULADO_FIXTURES, normalizarMensagem, withBackoff } from './connector-base.mjs'

const LOGIN_URL = 'https://www.gov.br/compras/pt-br/acesso-ao-sistema'
const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/acompanhamento'

/**
 * @param {{ credencial: {login: string, senha: string, storageState?: string},
 *           processos: Array<{licitacaoId: string}>, simulado?: boolean }} ctx
 */
export async function sync({ credencial, processos, simulado }) {
  // Modo simulado: pipeline completo sem browser (usado em dev/verificação).
  if (simulado) {
    const mensagens = []
    for (const p of processos.length ? processos : [{ licitacaoId: 'SIMULADO-0001' }]) {
      for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    }
    return { status: 'ok', detalhe: 'simulado', mensagens }
  }

  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    return { status: 'falha', detalhe: 'Playwright não instalado (npx playwright install chromium)', mensagens: [] }
  }

  let browser
  try {
    browser = await withBackoff(() => chromium.launch({ headless: true }))
    const context = await browser.newContext(
      credencial.storageState ? { storageState: JSON.parse(credencial.storageState) } : {},
    )
    const page = await context.newPage()

    // Vai direto à área autenticada de acompanhamento. Se a sessão caiu, o portal
    // redireciona para login — sinal de sessao_expirada.
    await withBackoff(() => page.goto(ACOMPANHAMENTO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }))

    const url = page.url()
    const conteudo = (await page.content()).toLowerCase()
    if (/captcha|recaptcha|hcaptcha/.test(conteudo)) {
      await browser.close()
      return { status: 'captcha_2fa', detalhe: 'CAPTCHA/2FA exigido — reconexão manual necessária', mensagens: [] }
    }
    if (/acesso-ao-sistema|login|entrar com gov\.br/.test(url + ' ' + conteudo)) {
      await browser.close()
      return { status: 'sessao_expirada', detalhe: 'Sessão expirada — reconecte as credenciais', mensagens: [], loginUrl: LOGIN_URL }
    }

    // Sessão válida: coleta as mensagens de chat de cada processo monitorado.
    // NOTA: seletores dependem do layout atual do portal — ajuste aqui quando mudar.
    const mensagens = []
    for (const p of processos) {
      try {
        const linhas = await page.$$eval(
          `[data-licitacao="${p.licitacaoId}"] .chat-msg, .mensagem-chat`,
          (els) => els.map((el) => ({
            autor: el.querySelector('.autor')?.textContent?.trim() ?? null,
            texto: el.querySelector('.texto')?.textContent?.trim() ?? el.textContent?.trim() ?? '',
            horario: el.querySelector('.horario')?.getAttribute('datetime') ?? null,
          })),
        ).catch(() => [])
        for (const l of linhas) {
          if (l.texto) mensagens.push(normalizarMensagem({ autor: l.autor, texto: l.texto, horarioOrigem: l.horario }, p.licitacaoId))
        }
      } catch { /* processo específico falhou: segue os demais */ }
    }

    // Persiste a sessão renovada para o próximo sync.
    const storageState = JSON.stringify(await context.storageState())
    await browser.close()
    return { status: 'ok', detalhe: `${mensagens.length} mensagem(ns)`, mensagens, storageState }
  } catch (e) {
    try { if (browser) await browser.close() } catch { /* ignore */ }
    const msg = String(e?.message ?? e)
    // Timeout/DNS/conexão ⇒ portal indisponível; o resto ⇒ falha genérica.
    if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) {
      return { status: 'portal_indisponivel', detalhe: msg.slice(0, 180), mensagens: [] }
    }
    return { status: 'falha', detalhe: msg.slice(0, 180), mensagens: [] }
  }
}
