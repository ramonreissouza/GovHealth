// scripts/licite/collect.mjs — coletor do Licitações-e (BB) via Playwright + OCR.
// Fluxo por (UF, situação): abre a Pesquisa avançada, resolve o CAPTCHA (OCR+retry),
// submete, e parseia a tabela de resultados. Filtra saúde (isSaude) fora daqui.
//
// A lista traz: Comprador (órgão) | Nº Licitação (id do link) | Descrição (objeto +
// UF + Modalidade + Nº Edital + Nº Processo). Datas/valor ficam só no detalhe (não
// coletados na v1). Link canônico do detalhe é montado a partir do número.

import { criarSolver } from './ocr.mjs'

const BASE = 'https://www.licitacoes-e.com.br'
const URL_BUSCA = `${BASE}/aop/pesquisar-licitacao.aop?opcao=preencherPesquisar`

// Situações "abertas" (recebendo/permitindo proposta ou em disputa).
export const SITUACOES_ABERTAS = {
  publicada: '2',
  acolhimento: '3',        // Acolhimento de propostas
  abertura: '4',
  propostasAbertas: '5',
  emDisputa: '6',
}

export function linkDetalhe(numero) {
  return `${BASE}/aop/consultar-detalhes-licitacao.aop?opcao=exibirDetalhesLicitacao&numeroLicitacao=${numero}`
}

// Extrai as linhas da tabela de resultados (roda no browser).
async function parsearResultados(page) {
  return page.evaluate(() => {
    const linhas = []
    const trs = document.querySelectorAll('table.dataTable tbody tr')
    for (const tr of trs) {
      const tds = tr.querySelectorAll('td')
      if (tds.length < 4) continue
      const orgao = (tds[1]?.innerText || '').trim()
      const linkEl = tds[2]?.querySelector('a.dialog_link, a[id]')
      const numero = (linkEl?.id || '').trim() || ((tds[2]?.innerText || '').trim())
      const cell = tds[3]
      const objeto = (cell?.querySelector('a')?.textContent || '').trim()
      const txt = (cell?.innerText || '').replace(/\s+/g, ' ')
      const uf = (txt.match(/UF:\s*([A-Z]{2})\b/) || [])[1] || ''
      const modalidade = (txt.match(/Modalidade\/tipo:\s*([^|\n]+?)\s*(?:N[ºo]\s*Edital|$)/i) || [])[1]?.trim() || ''
      const edital = (txt.match(/N[ºo]\s*Edital\s*:?\s*([^\s|]+)/i) || [])[1] || ''
      const processo = (txt.match(/N[ºo]\s*Processo\s*:?\s*([^\s|]+)/i) || [])[1] || ''
      if (numero && /^\d+$/.test(numero)) linhas.push({ numero, orgao, objeto, uf, modalidade, edital, processo })
    }
    return linhas
  })
}

/**
 * Busca licitações de UM (uf, situação). Resolve o CAPTCHA com retry (grátis).
 * Retorna array bruto (sem filtro de saúde) já normalizado.
 */
export async function buscar(page, ocr, { uf, situacao, maxTentativas = 20 }) {
  await page.goto(URL_BUSCA, { waitUntil: 'domcontentloaded', timeout: 45000 })
  let ultimoCaptcha = null
  const onResp = async (r) => { if (r.url().includes('captchaServlet.png')) { try { ultimoCaptcha = await r.body() } catch {} } }
  page.on('response', onResp)

  const setCampos = (g) => page.evaluate(({ g, uf, situacao }) => {
    function setSel(id, val) { const s = document.getElementById(id); if (s) { s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })) } }
    setSel('situacoes', situacao); setSel('unidades', uf); setSel('periodos', 'a')
    const f = document.forms['licitacaoPesquisaForm']
    if (f) { if (f.codigoSituacao) f.codigoSituacao.value = situacao; if (f.codigoPeriodo) f.codigoPeriodo.value = 'a'; if (f.textoSiglaUnidadeFederativa) f.textoSiglaUnidadeFederativa.value = uf }
    const cap = document.getElementById('pQuestionAvancada'); if (cap) cap.value = g
  }, { g, uf, situacao })

  try {
    for (let i = 1; i <= maxTentativas; i++) {
      await page.waitForTimeout(2000)
      if (!ultimoCaptcha) continue
      const guess = await ocr.solve(ultimoCaptcha)
      if (guess.length !== 5) {
        await page.evaluate(() => { const img = document.getElementById('img_captcha'); if (img) img.src = `https://www.licitacoes-e.com.br/aop/captchaServlet.png?idCaptcha=pCaptchaAvancada&id=${String(Math.random()).slice(2)}` })
        continue
      }
      await setCampos(guess)
      ultimoCaptcha = null
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        page.evaluate(() => document.querySelector('input[name="pesquisar"]').click()),
      ])
      await page.waitForTimeout(1500)
      const body = await page.evaluate(() => document.body.innerText)
      if (/insira os caracteres/i.test(body)) continue // captcha errado → nova tentativa
      // Sucesso. Espera o DataTables popular (senão parseia cedo e volta 0 linhas):
      // ou surge uma linha com link de detalhe, ou o texto indica "nenhum" resultado.
      await page.waitForFunction(() => {
        if (document.querySelector('table.dataTable a.dialog_link')) return true
        return /n[ãa]o foram encontrad|nenhum(a)? licita|nenhum registro/i.test(document.body.innerText)
      }, { timeout: 10000 }).catch(() => {})
      // DataTables mostra 10/página — expande para "Todos" (value -1) ou o maior valor,
      // para o DOM conter TODAS as linhas antes de parsear.
      await page.evaluate(() => {
        const sel = document.querySelector('.dataTables_length select, select[name$="_length"]')
        if (!sel) return
        const opts = [...sel.options].map((o) => o.value)
        const alvo = opts.includes('-1') ? '-1' : opts.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => b - a)[0]
        if (alvo != null) { sel.value = String(alvo); sel.dispatchEvent(new Event('change', { bubbles: true })) }
      })
      // Poll-parse: lê algumas vezes e fica com o MAIOR número de linhas — imune ao
      // re-render transitório do DataTables (que às vezes esvazia o tbody por um instante).
      let linhas = []
      for (let k = 0; k < 6; k++) {
        await page.waitForTimeout(1200)
        const l = await parsearResultados(page)
        if (l.length > linhas.length) linhas = l
        else if (linhas.length > 0 && k >= 2) break // estabilizou com dados
      }
      return { ok: true, tentativas: i, linhas }
    }
    return { ok: false, tentativas: maxTentativas, linhas: [] }
  } finally {
    page.off('response', onResp)
  }
}

export { criarSolver }
