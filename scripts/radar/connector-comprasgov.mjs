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
import { PORTAIS } from './portais.mjs'

const LOGIN_URL = 'https://www.gov.br/compras/pt-br/acesso-ao-sistema'
const ACOMPANHAMENTO_URL = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor'

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

    // ESPERAR O ANGULAR DESENHAR. O `domcontentloaded` acima volta com o HTML de
    // bootstrap da SPA, quando a tela ainda está vazia. Sem esta espera, as checagens
    // abaixo olham uma página em branco: nem acham o "página não encontrada", nem acham
    // sinal de login — e o conector seguia adiante e reportava `ok` com 0 mensagens.
    // Falso "ok" é pior que erro: some da lista de problemas e o fornecedor acha que
    // está monitorado.
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})

    const url = page.url()
    const conteudo = (await page.content()).toLowerCase()
    const texto = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).toLowerCase()

    // A ÁREA MUDOU DE ENDEREÇO — e isto precisa vir ANTES do teste de CAPTCHA.
    //
    // Medido em 13/09/2026 com uma sessão recém-criada e válida: esta URL renderiza
    // "Página não encontrada". E o teste de CAPTCHA abaixo era um `includes` no HTML
    // INTEIRO, então a palavra "captcha" em algum script da própria página de erro
    // casava — e o fornecedor recebia "CAPTCHA/2FA exigido — reconexão manual
    // necessária". Diagnóstico errado, e caro: manda o cliente refazer um login que
    // não resolve, porque o problema não é a sessão dele.
    if (/não encontrada|nao encontrada|página não existe/.test(texto)) {
      await browser.close()
      return { status: 'portal_indisponivel', mensagens: [],
        detalhe: 'A área de acompanhamento do Compras.gov.br respondeu "página não encontrada" — o endereço mudou. Não é problema da sua conexão; estamos recalibrando.' }
    }

    // CAPTCHA de verdade é um WIDGET VISÍVEL, não a palavra solta num script.
    const temCaptcha = await page.evaluate(() =>
      !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [class*="h-captcha"], #captcha'),
    ).catch(() => false)
    if (temCaptcha) {
      await browser.close()
      return { status: 'captcha_2fa', detalhe: 'CAPTCHA/2FA exigido — reconexão manual necessária', mensagens: [] }
    }
    if (/acesso-ao-sistema|login|entrar com gov\.br/.test(url + ' ' + conteudo)) {
      await browser.close()
      return { status: 'sessao_expirada', detalhe: 'Sessão expirada — reconecte as credenciais', mensagens: [], loginUrl: LOGIN_URL }
    }

    // PROVA POSITIVA antes de declarar sucesso. Até aqui só descartamos hipóteses de
    // erro conhecidas, e "não reconheci nenhum erro" NÃO é o mesmo que "estou na área
    // logada". O registro já tem o predicado que exige sinal de sessão no conteúdo
    // renderizado — é ele que decide, e é o mesmo usado pela captura.
    if (!PORTAIS.comprasgov.logado({ url, conteudo: texto })) {
      await browser.close()
      return { status: 'sessao_expirada', mensagens: [], loginUrl: LOGIN_URL,
        detalhe: 'A área autenticada não foi reconhecida (sem sinal de sessão na página) — não vou reportar "sem mensagens" sem ter lido a área de verdade.' }
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
