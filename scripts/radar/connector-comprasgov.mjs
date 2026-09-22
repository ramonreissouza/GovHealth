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
import { serializarSessaoRecortada } from './sessao-escopo.mjs'

const LOGIN_URL = PORTAIS.comprasgov.loginUrl
// UMA fonte de verdade para o endereço da área. Antes havia uma cópia da URL aqui e
// outra no registro, e elas divergiram: o registro já apontava para a rota nova
// enquanto o conector continuava batendo na antiga. Endereço duplicado é endereço que
// vai ficar velho em um dos dois lugares.
const ACOMPANHAMENTO_URL = PORTAIS.comprasgov.areaUrl
// Raiz da area do pregao, para os quadros irmaos (Acompanhar.asp, avisos.asp).
const BASE = ACOMPANHAMENTO_URL.replace(/\/[^/]*$/, '')

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
    // A PALAVRA "login" NÃO PODE SER PROCURADA NO HTML INTEIRO. A área logada do
    // comprasnet carrega `main.asp?login=U0000…` no próprio frameset — procurar a
    // palavra solta faz o conector declarar "sessão expirada" exatamente quando a
    // sessão está boa, e manda o fornecedor reconectar à toa. Aqui: a URL decide (é
    // ela que muda quando o portal expulsa), e o texto VISÍVEL serve de reforço.
    if (PORTAIS.comprasgov.emLogin({ url }) || /acesso-ao-sistema|loginportal/.test(url) ||
        /faça o login|faca o login|entrar com gov\.br/.test(texto)) {
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

    // O CHAT NÃO É POR "PREGÃO MONITORADO" — é por PREGÃO EM QUE A EMPRESA PARTICIPA.
    //
    // A versão anterior varria os `processos` (os 519 que o Radar acompanha pelo perfil)
    // procurando `[data-licitacao="…"] .chat-msg` na página do menu. Esses seletores
    // nunca existiram nesta área, e o resultado era sempre 0 — um zero que PARECIA
    // resposta. Medido em 13/09/2026 com sessão real: a própria área responde
    // "No momento não existem licitações para acompanhar" quando não há participação.
    //
    // Então perguntamos ao portal, em vez de adivinhar: o Quadro de Acompanhamento
    // lista o que existe para ler. Lista vazia é uma resposta legítima e dita com todas
    // as letras; lista cheia que não sabemos ler é FALHA, e tem de aparecer como falha.
    const mensagens = []
    await page.goto(`${BASE}/Acompanhar.asp`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    const acomp = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).toLowerCase()

    if (/não existem licita|nao existem licita/.test(acomp)) {
      // LER O ESTADO ANTES DE FECHAR. Invertido, o Playwright devolve "Target page,
      // context or browser has been closed" — e o conector inteiro vira 'falha' por um
      // detalhe de ordem, com a sessão perfeitamente boa.
      // Renovar a sessao NAO pode re-alargar o cofre: sem o recorte aqui, a primeira
      // passada bem-sucedida devolveria os cookies do SSO que a captura acabou de tirar.
      const { json: renovado } = serializarSessaoRecortada(await context.storageState(), 'comprasgov')
      await browser.close()
      return { status: 'ok', mensagens, storageState: renovado,
        detalhe: 'nenhuma licitação em acompanhamento para este CNPJ (o portal não tem chat sem participação)' }
    }

    // Há licitações em acompanhamento. A leitura por licitação AINDA NÃO ESTÁ
    // CALIBRADA — não houve nenhuma participação ativa para servir de amostra, e eu não
    // vou inventar seletor: chutar aqui produz exatamente o silêncio que este conector
    // já produziu uma vez. Devolve falha com o que foi visto, para calibrar com dado
    // real na primeira licitação que aparecer.
    const linhas = await page.$$eval('table tr', (trs) =>
      trs.map((tr) => (tr.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => /\d{4,}/.test(t)).slice(0, 10),
    ).catch(() => [])
    await browser.close()
    return { status: 'falha', mensagens: [],
      detalhe: `há licitação(ões) em acompanhamento e a leitura do chat ainda não foi calibrada: ${linhas.join(' | ').slice(0, 300)}` }

    // Persiste a sessão renovada para o próximo sync.
    const { json: storageState } = serializarSessaoRecortada(await context.storageState(), 'comprasgov')
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
