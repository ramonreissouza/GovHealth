// scripts/radar/connector-pcp.mjs — conector do Portal de Compras Públicas (PCP).
// ETAPA 2 (CALIBRADO — modo público): o PCP publica cada processo em
// /processos/{uf}/{orgao}/{processo} de forma PÚBLICA (Google indexa). A seção
// "Andamento do processo" traz o chat/histórico do pregoeiro em `.timeline-item`
// (`.time` = "DD/MM/YYYY HH:MM:SS | Autor", `.description` = mensagem) e
// "Documentos" traz a "Ata Final" com o chat completo — tudo SEM login.
// Verificado em 2026-08-01 contra um pregão real de saúde (headless, sem conta).
//
// Portanto o monitoramento de eventos/andamento roda de GRAÇA (modo público). O
// chat AO VIVO da sala de disputa (lances em tempo real) ainda exige a sessão do
// PRÓPRIO cliente (cada fornecedor só vê os processos dele) — esse caminho fica
// pendente de calibração com sessão de um assinante (chatUrlDoProcesso).
//
// Referência de implementação: connector-comprasgov.mjs.

import { SIMULADO_FIXTURES, normalizarMensagem, withBackoff } from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const META = portalMeta('pcp')
const UA_NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * Converte horário BR ("10/07/2026 18:50:39" ou "10/07/2026 18:50") em ISO com
 * fuso de Brasília (-03:00). O banco grava em TIMESTAMPTZ — sem isso, "23/08/2024"
 * seria interpretado como mês 23 e QUEBRARIA o INSERT. Sem casar → null (seguro).
 */
export function horarioBrParaISO(s) {
  const m = String(s ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, d, mo, y, h, mi, se] = m
  const p = (n) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se || '00')}-03:00`
}

// URL da sala de disputa AO VIVO por processo (lances em tempo real) — A CALIBRAR
// com a sessão de um assinante (null = ainda não confirmado). O andamento público
// (abaixo) já cobre o histórico/eventos sem isso.
const chatUrlDoProcesso = null // (id) => `https://www.portaldecompraspublicas.com.br/...`

/**
 * Extração PRECISA (calibrada) do "Andamento do processo" na página PÚBLICA do PCP.
 * Cada mensagem é um `.timeline-item` com `.time` ("DD/MM/YYYY HH:MM:SS | Autor")
 * e `.description` (texto). Ignora o `app-timeline` de fases (que não tem `.description`).
 * @returns {Promise<Array<{autor:string|null, texto:string, horario:string|null}>>}
 */
export async function extrairAndamentoPublico(page) {
  return page.evaluate(() => {
    const out = []
    for (const item of document.querySelectorAll('.timeline-item')) {
      const t = item.querySelector('.time')
      const d = item.querySelector('.description')
      if (!t || !d) continue // fases do processo não têm .description → ignora
      const time = (t.innerText || t.textContent || '').replace(/\s+/g, ' ').trim()
      const texto = (d.innerText || d.textContent || '').replace(/\s+/g, ' ').trim()
      if (!texto) continue
      const m = time.match(/^(.*?)\s*\|\s*(.+)$/) // "17/07/2024 19:25:31 | Sistema"
      out.push({ autor: m ? m[2].trim() : null, texto, horario: m ? m[1].trim() : (time || null) })
    }
    return out
  })
}

/**
 * Extração HEURÍSTICA de mensagens de chat de uma página já aberta (Playwright).
 * Não depende de classes CSS exatas: procura blocos cujo texto tenha um PAPEL
 * (Pregoeiro/Fornecedor/Sistema/Participante) e, de preferência, um horário.
 * Fallback do modo público e reutilizada pela calibração da sala AO VIVO.
 * @returns {Promise<Array<{autor:string|null, texto:string, horario:string|null}>>}
 */
export async function extrairMensagensHeuristica(page) {
  return page.evaluate(() => {
    const PAPEL = /(preg[oa]eiro|fornecedor|licitante|sistema|participante|autoridade|comiss[aã]o)/i
    const HORA = /\d{1,2}\/\d{1,2}\/\d{2,4}.*?\d{1,2}:\d{2}|\d{1,2}:\d{2}(:\d{2})?/
    const out = []
    const vistos = new Set()
    // Considera nós "folha-ish" (poucos filhos-elemento) com texto relevante.
    const nodes = Array.from(document.querySelectorAll('li, tr, p, div'))
    for (const el of nodes) {
      const filhosEl = el.querySelectorAll(':scope > *').length
      if (filhosEl > 6) continue
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      if (txt.length < 8 || txt.length > 1200) continue
      if (!PAPEL.test(txt)) continue
      const chave = txt.slice(0, 160)
      if (vistos.has(chave)) continue
      vistos.add(chave)
      const mp = txt.match(PAPEL)
      const mh = txt.match(HORA)
      // SEM HORÁRIO NÃO É MENSAGEM. Só o papel ("fornecedor", "autoridade") casava com
      // o menu do portal e com o rodapé, e isso virava mensagem no radar: "Processos
      // Comprador Fornecedor Marketplace…", "CRIE SUA CONTA", telefone da central.
      // Eram 7% do que o cliente via na tela. Todo item real do andamento tem data/hora.
      if (!mh) continue
      // autor = trecho até ':' se começar com um papel; senão o próprio papel casado.
      let autor = null
      const antesDoisPontos = txt.split(/[:—-]/)[0]?.trim()
      if (antesDoisPontos && PAPEL.test(antesDoisPontos) && antesDoisPontos.length <= 60) autor = antesDoisPontos
      else if (mp) autor = mp[0]
      out.push({ autor, texto: txt, horario: mh ? mh[0] : null })
    }
    return out
  })
}

/**
 * MODO PÚBLICO (sem login): abre a página pública de cada processo que traga
 * `urlPublica` e extrai o "Andamento do processo". Não exige credencial — é o
 * ganho da etapa 2. Processos sem `urlPublica` são ignorados aqui.
 * @param {Array<{licitacaoId:string, urlPublica?:string}>} processos
 */
async function monitorarPublico(processos) {
  const alvos = processos.filter((p) => p?.urlPublica)
  if (!alvos.length) return { atendidos: 0, mensagens: [] }

  let chromium
  try { ({ chromium } = await import('playwright')) }
  catch { throw new Error('Playwright não instalado (npx playwright install chromium)') }

  const browser = await withBackoff(() => chromium.launch({ headless: true }))
  const mensagens = []
  try {
    const context = await browser.newContext({ userAgent: UA_NAVEGADOR })
    const page = await context.newPage()
    for (const p of alvos) {
      try {
        await withBackoff(() => page.goto(p.urlPublica, { waitUntil: 'domcontentloaded', timeout: 45000 }))
        await page.waitForTimeout(4000) // Angular hidrata o andamento
        try { await page.getByText(/andamento do processo/i).first().scrollIntoViewIfNeeded({ timeout: 4000 }) } catch { /* ok */ }
        let linhas = await extrairAndamentoPublico(page).catch(() => [])
        if (!linhas.length) linhas = await extrairMensagensHeuristica(page).catch(() => [])
        for (const l of linhas) {
          if (l.texto) mensagens.push(normalizarMensagem({ autor: l.autor, texto: l.texto, horarioOrigem: horarioBrParaISO(l.horario), horarioBr: l.horario }, p.licitacaoId))
        }
      } catch { /* processo específico falhou: segue os demais */ }
    }
  } finally {
    try { await browser.close() } catch { /* ignore */ }
  }
  return { atendidos: alvos.length, mensagens }
}

/**
 * @param {{ credencial: {login:string, storageState?:string},
 *           processos: Array<{licitacaoId:string, urlPublica?:string}>, simulado?:boolean }} ctx
 */
export async function sync({ credencial, processos = [], simulado }) {
  if (simulado) {
    const mensagens = []
    const alvos = processos.length ? processos : [{ licitacaoId: 'SIMULADO-pcp' }]
    for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
  }

  // MODO PÚBLICO primeiro: cobre andamento/eventos sem login para quem tem urlPublica.
  const temPublico = processos.some((p) => p?.urlPublica)
  if (temPublico) {
    try {
      const { atendidos, mensagens } = await monitorarPublico(processos)
      // Se NÃO houver credencial, o público é o resultado final (honesto).
      if (!credencial?.storageState) {
        return { status: 'ok', detalhe: `público: ${mensagens.length} mensagem(ns) em ${atendidos} processo(s)`, mensagens }
      }
      // Com credencial, o público entra e a sessão tenta complementar (ao vivo) abaixo.
      var mensagensPublicas = mensagens
    } catch (e) {
      if (!credencial?.storageState) return { status: 'falha', detalhe: String(e?.message ?? e).slice(0, 180), mensagens: [] }
    }
  }

  if (!credencial?.storageState) {
    return { status: 'sessao_expirada', detalhe: `Sessão do ${META.nome} não capturada — conecte pelo Radar`, mensagens: [], loginUrl: META.loginUrl }
  }

  let chromium
  try { ({ chromium } = await import('playwright')) }
  catch { return { status: 'falha', detalhe: 'Playwright não instalado (npx playwright install chromium)', mensagens: [] } }

  let browser
  try {
    browser = await withBackoff(() => chromium.launch({ headless: true }))
    const context = await browser.newContext({ storageState: JSON.parse(credencial.storageState) })
    const page = await context.newPage()

    // 1) valida a sessão abrindo a área autenticada.
    await withBackoff(() => page.goto(META.areaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }))
    const url = page.url()
    const conteudo = (await page.content().catch(() => '')).toLowerCase()
    if (/captcha|recaptcha|hcaptcha/.test(conteudo)) {
      await browser.close()
      return { status: 'captcha_2fa', detalhe: 'CAPTCHA exigido — reconexão manual', mensagens: [] }
    }
    if (!META.logado({ url, conteudo })) {
      await browser.close()
      return { status: 'sessao_expirada', detalhe: 'Sessão expirada — reconecte a credencial', mensagens: [], loginUrl: META.loginUrl }
    }

    const publicas = typeof mensagensPublicas !== 'undefined' ? mensagensPublicas : []

    // 2) navega até a sala AO VIVO de cada processo — DEPENDE da calibração da URL.
    if (typeof chatUrlDoProcesso !== 'function') {
      const storageState = JSON.stringify(await context.storageState())
      await browser.close()
      // O andamento público já entrega valor; a sala ao vivo fica pendente de calibração.
      return {
        status: 'ok',
        detalhe: `público: ${publicas.length} mensagem(ns); sala ao vivo pendente de calibração (radar:calibrate-pcp)`,
        mensagens: publicas, storageState,
      }
    }

    const mensagens = [...publicas]
    for (const p of processos) {
      try {
        await withBackoff(() => page.goto(chatUrlDoProcesso(p.licitacaoId), { waitUntil: 'domcontentloaded', timeout: 30000 }))
        const linhas = await extrairMensagensHeuristica(page).catch(() => [])
        for (const l of linhas) {
          if (l.texto) mensagens.push(normalizarMensagem({ autor: l.autor, texto: l.texto, horarioOrigem: horarioBrParaISO(l.horario), horarioBr: l.horario }, p.licitacaoId))
        }
      } catch { /* processo específico falhou: segue os demais */ }
    }

    const storageState = JSON.stringify(await context.storageState())
    await browser.close()
    return { status: 'ok', detalhe: `${mensagens.length} mensagem(ns)`, mensagens, storageState }
  } catch (e) {
    try { if (browser) await browser.close() } catch { /* ignore */ }
    const msg = String(e?.message ?? e)
    if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) {
      return { status: 'portal_indisponivel', detalhe: msg.slice(0, 180), mensagens: [] }
    }
    return { status: 'falha', detalhe: msg.slice(0, 180), mensagens: [] }
  }
}
