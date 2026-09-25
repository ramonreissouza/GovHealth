import { compraPublica, mensagemPublica } from '../../src/lib/radar/comprasgov-publico.mjs'
import { abrirPagina, PortalRecusou } from './connector-base.mjs'
import { fileURLToPath } from 'node:url'

export class DesafioPublico extends Error {
  constructor() { super('A consulta pública exige CAPTCHA. Use o modo assistido e resolva o desafio no navegador oficial.'); this.name = 'DesafioPublico' }
}
export class CompraNaoEncontrada extends Error {
  constructor() { super('O portal exibiu “Compra não encontrada”. Confirme o link pela pesquisa oficial do Compras.gov.br; não foi possível verificar as mensagens.'); this.name = 'CompraNaoEncontrada' }
}
export class PesquisaNaoConfirmada extends Error {
  constructor() { super('A pesquisa pública não retornou resultado confirmável. Isso não prova que a compra não exista; o desafio ou a consulta pode ter falhado. Nenhuma mensagem foi verificada.'); this.name = 'PesquisaNaoConfirmada' }
}
export function rotaCompraNaoEncontrada(url) {
  try { return new URL(url).pathname.replace(/\/$/, '') === '/comprasnet-web/compra-nao-encontrada' } catch { return false }
}
// Fluxo conferido na UI oficial: pesquisa por UASG + número/ano e “Acompanhar compra”.
// Não constrói chamadas à API de consulta nem transporta tokens de CAPTCHA.
export async function abrirPelaPesquisa(page, compra, verificar) {
  const pesquisa = new URL('/comprasnet-web/public/compras', compra.url).href
  for (const situacao of ['Finalizadas', 'Em andamento']) {
    await abrirPagina(page, pesquisa, { tentativas: 1 })
    const unidade = page.locator('#unidadeCompradora')
    for (let i = 0; !await unidade.isVisible(); i++) {
      await verificar()
      if (i >= 45) throw new Error('Timeout ao abrir pesquisa pública.')
      await page.waitForTimeout(1000)
    }
    await page.getByRole('radio', { name: situacao, exact: true }).check()
    const etapas = situacao === 'Finalizadas' ? ['Homologadas','Desertas']
      : ['Abertas para participação','Em disputa','Em seleção de fornecedores']
    for (const nome of etapas) await page.getByRole('checkbox',{ name:nome, exact:true }).check()
    await unidade.fill(compra.chave.slice(0,6))
    await page.locator('#numeroAnoCompra input').fill(compra.chave.slice(8))
    await page.getByRole('button',{ name:'Pesquisar', exact:true }).click()
    const acompanhar = page.getByRole('button',{ name:'Acompanhar compra', exact:true })
    for (let i = 0; i < 30; i++) {
      await verificar()
      const n = await acompanhar.count()
      if (n > 1) throw new Error('Pesquisa pública ambígua: mais de uma compra para a UASG e número/ano.')
      if (n === 1 && await acompanhar.isVisible()) {
        await acompanhar.click()
        await page.waitForURL((url) => url.pathname !== '/comprasnet-web/public/compras', { timeout: 20_000 })
        if (compraPublica(page.url())?.chave !== compra.chave) throw new Error('A pesquisa abriu uma compra diferente da cadastrada; captura cancelada.')
        return
      }
      await page.waitForTimeout(1000)
    }
  }
  throw new PesquisaNaoConfirmada()
}
export async function temDesafioPublico(page) {
  // O selo pequeno hCaptcha existe mesmo em leituras bem-sucedidas.
  // Somente um iframe de desafio visível e grande indica intervenção humana.
  for (const frame of await page.locator('iframe[src*="hcaptcha.com"]').all()) {
    if (!await frame.isVisible()) continue
    const caixa = await frame.boundingBox()
    if (caixa && caixa.width > 200 && caixa.height > 200) return true
  }
  return false
}
async function aguardarIntervencao(page) {
  console.log('Compras.gov.br: resolva o CAPTCHA manualmente na janela oficial aberta. A coleta aguarda até 10 minutos.')
  const fim = Date.now() + 600_000
  while (await temDesafioPublico(page)) {
    if (Date.now() >= fim) throw new DesafioPublico()
    await page.waitForTimeout(1000)
  }
}
export async function abrirPainel(page, verificar) {
  const botao = page.locator('app-botao-mensagens-da-compra button:visible').first()
  let tentativas = 0
  while (!await botao.isVisible()) {
    if (rotaCompraNaoEncontrada(page.url())) throw new CompraNaoEncontrada()
    await verificar()
    if (++tentativas > 45) throw new Error('Timeout ao aguardar painel de mensagens.')
    await page.waitForTimeout(1000)
  }
  await botao.click({ timeout: 10_000 })
}

// Estes seletores foram observados no DOM da consulta pública, incluindo página 2.
// Não consulta APIs privadas, não reutiliza cookies gov.br e não resolve desafios.
export function extrairPainelPublico() {
  const painel = [...document.querySelectorAll('[role="complementary"]')]
    .find((p) => p.querySelector('h3')?.textContent.trim() === 'Mensagens')
  if (!painel) return null
  const linhas = [...painel.querySelectorAll('.mensagem-card')].map((card) => ({
    autor: card.querySelector('.mensagens-remetente')?.textContent.trim() || '',
    texto: card.querySelector('.mensagens-texto')?.textContent.trim() || '',
    lote: card.querySelector('.mensagens-item')?.textContent.trim() || null,
    horario: card.querySelector('.mensagens-data')?.textContent.trim() || '',
  }))
  const proximo = painel.querySelector('button[aria-label="Próxima Página"]')
  return { linhas, temProxima: !!proximo && !proximo.disabled, paginador: !!proximo }
}

export async function lerPaginasPublicas(page, { licitacaoId, chave, maxPaginas = 20, verificar = () => {} }) {
  if (!Number.isInteger(maxPaginas) || maxPaginas < 1 || maxPaginas > 100) throw new Error('Limite de páginas inválido.')
  const mensagens = []
  const vistos = new Set()
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    await verificar()
    // Na troca de página, o portal remove os cards enquanto busca os seguintes.
    // Vazio transitório nunca significa "sem mensagens". Sem prova de vazio, falha.
    await page.locator('[role="complementary"] .mensagem-card').first().waitFor({ state: 'visible', timeout: 20_000 })
    await verificar()
    const leitura = await page.evaluate(extrairPainelPublico)
    if (!leitura?.linhas.length || !leitura.paginador) throw new Error('Painel público sem mensagens/paginação verificáveis.')
    const assinatura = JSON.stringify(leitura.linhas)
    if (vistos.has(assinatura)) throw new Error('Paginação não avançou; leitura interrompida.')
    vistos.add(assinatura)
    mensagens.push(...leitura.linhas.map((m) => mensagemPublica(m, licitacaoId, chave)))
    if (!leitura.temProxima) return { mensagens, completa: true, paginas: pagina + 1 }
    if (pagina + 1 === maxPaginas) return { mensagens, completa: false, paginas: pagina + 1 }
    await page.getByRole('complementary').getByRole('button', { name: 'Próxima Página', exact: true }).click()
    // Exige conteúdo diferente, além de a página deixar de estar em carregamento.
    await page.waitForFunction(({ anterior }) => {
      const painel = [...document.querySelectorAll('[role="complementary"]')].find((p) => p.querySelector('h3')?.textContent.trim() === 'Mensagens')
      const linhas = [...(painel?.querySelectorAll('.mensagem-card') || [])].map((card) => ({
        autor: card.querySelector('.mensagens-remetente')?.textContent.trim() || '',
        texto: card.querySelector('.mensagens-texto')?.textContent.trim() || '',
        lote: card.querySelector('.mensagens-item')?.textContent.trim() || null,
        horario: card.querySelector('.mensagens-data')?.textContent.trim() || '',
      }))
      return linhas.length > 0 && JSON.stringify(linhas) !== anterior
    }, { anterior: assinatura }, { timeout: 20_000 })
    await page.waitForTimeout(1500)
  }
}

let recusadoNestaRodada = false
let desafioNestaRodada = false
export function diagnosticoPublico(e, etapa) {
  if (e instanceof PesquisaNaoConfirmada) return e.message
  if (e instanceof CompraNaoEncontrada) return e.message
  if (e instanceof DesafioPublico) return e.message
  if (e instanceof PortalRecusou) return `Portal recusou a consulta (HTTP ${e.status}); tentativas suspensas.`
  if (etapa === 'navegador') return /Executable doesn't exist/.test(e?.message || '')
    ? 'Chromium não instalado. Execute npx playwright install chromium no ambiente do coletor.'
    : 'Não foi possível iniciar o Chromium. Verifique permissões de execução e dependências do coletor.'
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(e?.message || '')) return 'Falha de DNS ao acessar a consulta pública.'
  if (/ERR_CERT/.test(e?.message || '')) return 'Falha de certificado TLS ao acessar a consulta pública.'
  if (/Timeout|timeout/.test(e?.message || '')) return `Tempo esgotado na etapa ${etapa}; a leitura não foi confirmada.`
  return `Leitura interrompida na etapa ${etapa}; verifique indisponibilidade ou alteração da página.`
}
export async function sync({ processos = [], simulado = false, diagnosticar, viaPesquisa = false, assistido = process.env.RADAR_PUBLICO_ASSISTIDO === '1' }) {
  if (simulado) return { status: 'falha', detalhe: 'O conector público não apresenta dados simulados como leitura real.', mensagens: [], lidos: 0 }
  if (recusadoNestaRodada) return { status: desafioNestaRodada ? 'captcha_2fa' : 'portal_indisponivel', detalhe: 'Portal exige intervenção ou recusou consulta nesta rodada; tentativas suspensas.', mensagens: [], lidos: 0 }
  const maxProcessos = 5
  const mensagens = []
  let lidos = 0, parciais = 0, erro = null, browser, context, etapa = 'navegador', retryAfterSeconds = 0
  try {
    const { chromium } = await import('playwright')
    const opcoes = { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' }
    if (assistido) {
      context = await chromium.launchPersistentContext(fileURLToPath(new URL('./.calibra/comprasgov-publico-perfil', import.meta.url)), { ...opcoes, headless: false })
    } else {
      browser = await chromium.launch({ headless: true })
      context = await browser.newContext(opcoes)
    }
    for (const processo of processos.slice(0, maxProcessos)) {
      const compra = compraPublica(processo.urlPublica)
      if (!compra) { erro = 'Link público da compra ausente ou inválido.'; break }
      const page = await context.newPage()
      const rede = [], errosPagina = []
      let recusou = null
      const observar = (response) => {
        const status = response.status()
        const url = new URL(response.url())
        if (diagnosticar && rede.length < 100) rede.push({ status, recurso: url.origin === new URL(compra.url).origin ? url.pathname : url.hostname })
        if (url.origin === new URL(compra.url).origin && [401, 403, 429].includes(status)) {
          recusou = status
          const valor = response.headers()['retry-after']
          const segundos = /^\d+$/.test(valor || '') ? Number(valor) : Math.ceil((Date.parse(valor) - Date.now()) / 1000)
          if (Number.isFinite(segundos)) retryAfterSeconds = Math.max(retryAfterSeconds, Math.min(604800, segundos))
        }
      }
      page.on('response', observar)
      if (diagnosticar) {
        page.on('requestfailed', (r) => { if (rede.length < 100) rede.push({ falha: r.failure()?.errorText, recurso: new URL(r.url()).hostname }) })
        page.on('pageerror', (e) => errosPagina.push(e.message.slice(0, 300)))
      }
      const verificar = async () => {
        if (recusou) throw new PortalRecusou(recusou, compra.url)
        if (await temDesafioPublico(page)) {
          if (!assistido) throw new DesafioPublico()
          await aguardarIntervencao(page)
        }
      }
      try {
        etapa = 'abrir compra'
        if (viaPesquisa) { etapa = 'pesquisar compra no portal'; await abrirPelaPesquisa(page, compra, verificar) }
        else await abrirPagina(page, compra.url, { tentativas: 1 })
        // Botão do envelope observado no componente específico da compra.
        etapa = 'abrir painel de mensagens'
        try { await abrirPainel(page, verificar) } catch (e) {
          if (!(e instanceof CompraNaoEncontrada) || viaPesquisa) throw e
          etapa = 'pesquisar compra no portal'
          await abrirPelaPesquisa(page, compra, verificar)
          await abrirPainel(page, verificar)
        }
        await verificar()
        etapa = 'ler páginas de mensagens'
        const leitura = await lerPaginasPublicas(page, { licitacaoId: processo.licitacaoId, chave: compra.chave, verificar })
        mensagens.push(...leitura.mensagens)
        if (!leitura.completa) parciais++
        lidos++
      } catch (e) {
        if (diagnosticar) await diagnosticar({ page, etapa, rede, errosPagina, erroLeitura: String(e?.message || e).slice(0, 1500) }).catch(() => {})
        if (rotaCompraNaoEncontrada(page.url())) throw new CompraNaoEncontrada()
        if (e instanceof DesafioPublico) throw e
        await verificar()
        throw e
      } finally {
        if (recusou) recusadoNestaRodada = true
        page.off('response', observar)
        await page.close()
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  } catch (e) {
    if (e instanceof PortalRecusou) recusadoNestaRodada = true
    if (e instanceof DesafioPublico) { recusadoNestaRodada = true; desafioNestaRodada = true }
    erro = diagnosticoPublico(e, etapa)
  } finally { await context?.close().catch(() => {}); await browser?.close().catch(() => {}) }
  const completo = !erro && lidos === processos.length && lidos > 0 && parciais === 0
  return {
    status: completo ? 'ok' : desafioNestaRodada ? 'captcha_2fa' : recusadoNestaRodada ? 'portal_indisponivel' : 'falha', mensagens, lidos, retryAfterSeconds,
    detalhe: `${lidos}/${processos.length} compras consultadas; ${mensagens.length} mensagens públicas. ${erro || (parciais ? 'Histórico parcial: limite de 20 páginas por compra; sem garantia de cobertura completa.' : !completo ? 'Há compras pendentes.' : 'Leitura pública concluída; mensagens restritas e diligências privadas não estão cobertas.')}`,
  }
}
