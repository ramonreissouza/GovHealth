// scripts/radar/connector-ammlicita.mjs — conector do AMM LICITA (MODO PÚBLICO, sem login).
//
// A AMM Licita publica cada processo em /pesquisa/<id>, aberto a qualquer um. Medido em
// 14/09/2026 num navegador limpo: 864 contratações de saúde em 180 dias.
//
// É A MESMA APLICAÇÃO DO LICITAR DIGITAL (mesma rota `/pesquisa/<id>`, ids na mesma
// faixa numérica — provavelmente a mesma instalação com dois domínios). A diferença é
// que o `app2.licitardigital.com.br` responde com o desafio de robô da Cloudflare
// (HTTP 403) e o `app2.ammlicita.org.br` não. O Radar NÃO burla proteção de robô
// (requisito 4.2 + ToS), então só o domínio aberto entra — e, se a Cloudflare aparecer
// aqui um dia, este conector diz isso com todas as letras em vez de devolver zero.
//
// O QUE ELE LÊ — dois quadros, e os dois valem:
//
//   · SOLICITAÇÕES — impugnação, esclarecimento e recurso, com o PEDIDO, a RESPOSTA, os
//     anexos e o desfecho no título ("Impugnação - VALE COMÉRCIO DE MOTOS LTDA
//     INDEFERIDA"). É o quadro mais decisivo de todos os portais ligados até aqui: uma
//     impugnação deferida muda o edital, e quem descobre depois perde a licitação.
//   · AVISOS — atos do condutor sobre os lotes ("Lote 1 foi declarado como fracassado.
//     Motivo do fracasso: Outros. Deserto"), assinados e datados.
//
// COMO SE ANCORA: pelo `header > h1` de cada quadro ("Solicitações", "Avisos"), não por
// classe. A página é Material-UI com styled-components, e as classes são hashes
// (`sc-cmaqmh rwTQm`) que trocam a cada build — ancorar nelas é garantir quebra silenciosa.
//
// DUAS DATAS, DOIS FORMATOS, no mesmo processo: as solicitações escrevem "7 de setembro
// de 2026 às 22:35" e os avisos "11/09/2026 11:00". Os dois viram ISO -03:00.

import { SIMULADO_FIXTURES, horarioBrParaISO, normalizarMensagem, withBackoff } from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const META = portalMeta('ammlicita')
const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const TETO_PROCESSOS = 60

const MESES = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

/** "7 de setembro de 2026 às 22:35" → ISO -03:00. Sem casar → null (seguro). */
export function horarioPorExtensoParaISO(s) {
  const m = String(s ?? '')
    .toLowerCase()
    .match(/(\d{1,2})\s+de\s+([a-zçã]+)\s+de\s+(\d{4})\s+[àa]s\s+(\d{1,2}):(\d{2})/)
  if (!m) return null
  const mes = MESES[m[2]]
  if (!mes) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${m[3]}-${p(mes)}-${p(m[1])}T${p(m[4])}:${m[5]}:00-03:00`
}

/** A URL é a página pública de um processo da AMM Licita? */
export function urlDePesquisa(url) {
  return /ammlicita\.org\.br\/pesquisa\/\d+/i.test(String(url ?? ''))
}

/**
 * Lê os quadros "Solicitações" e "Avisos".
 * Devolve `null` quando NENHUM dos dois existe — a página não renderizou, e isso é
 * falha, não silêncio. Quadro presente e vazio ("Nenhuma mensagem encontrada") é
 * resposta legítima.
 */
export async function extrairMensagensAmm(page) {
  return page.evaluate(() => {
    const EXTENSO = /\d{1,2}\s+de\s+[a-zçã]+\s+de\s+\d{4}\s+[àa]s\s+\d{1,2}:\d{2}/i
    const NUMERICA = /\d{1,2}\/\d{1,2}\/\d{4}[\s,]+\d{1,2}:\d{2}/

    const cardDe = (titulo) => {
      const h = Array.from(document.querySelectorAll('header > h1')).find(
        (x) => x.textContent.trim().toLowerCase() === titulo,
      )
      return h ? h.closest('header')?.parentElement ?? null : null
    }
    const limpo = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim()

    const solic = cardDe('solicitações')
    const avisos = cardDe('avisos')
    if (!solic && !avisos) return null

    const out = []

    // ── SOLICITAÇÕES ─────────────────────────────────────────────────────────
    // Cada unidade (pedido OU resposta) tem um <p> com o texto, um bloco com a data por
    // extenso e os anexos como chips. O título do bloco pai carrega o desfecho.
    if (solic) {
      const datas = Array.from(solic.querySelectorAll('*')).filter(
        (e) => e.children.length === 0 && EXTENSO.test((e.textContent || '').trim()),
      )
      for (const d of datas) {
        const unidade = d.parentElement
        if (!unidade) continue
        const texto = limpo(unidade.querySelector('p'))
        // Título da solicitação: o h1 mais próximo subindo a árvore.
        let assunto = ''
        for (let n = unidade, i = 0; n && i < 6; n = n.parentElement, i++) {
          const h = n.querySelector?.('h1')
          if (h && !/^solicita/i.test(h.textContent.trim())) { assunto = limpo(h); break }
        }
        const anexos = Array.from(unidade.querySelectorAll('[role="button"]'))
          .map((b) => limpo(b))
          .filter((n) => /\.\w{2,5}$/.test(n))
          .map((nome) => ({ nome }))
        const corpo = [assunto ? `[${assunto}]` : '', texto].filter(Boolean).join(' ').trim()
        if (!corpo) continue
        out.push({ quadro: 'solicitação', autor: null, texto: corpo, horario: d.textContent.trim(), anexos })
      }
    }

    // ── AVISOS ───────────────────────────────────────────────────────────────
    // Uma linha por aviso; o último <span> é "AUTOR - DD/MM/YYYY HH:MM".
    if (avisos) {
      for (const tr of avisos.querySelectorAll('tbody tr')) {
        const paper = tr.querySelector('div')
        if (!paper) continue
        const texto = limpo(paper.querySelector('p'))
        const rodape = limpo(Array.from(paper.querySelectorAll('span')).pop())
        if (!texto || !NUMERICA.test(rodape)) continue
        const sep = rodape.lastIndexOf(' - ')
        const autor = sep > 0 ? rodape.slice(0, sep).trim() : null
        out.push({ quadro: 'aviso', autor, texto, horario: sep > 0 ? rodape.slice(sep + 3).trim() : rodape, anexos: [] })
      }
    }

    return out
  })
}

/**
 * A página é o desafio de robô da Cloudflare (e não o processo)?
 * Exportado para poder ser exercitado contra o domínio que REALMENTE devolve o desafio
 * (app2.licitardigital.com.br) — aqui o filtro de URL nunca deixaria chegar nele.
 */
export async function ehDesafioDeRobo(page) {
  const url = page.url()
  if (/__cf_chl/i.test(url)) return true
  const txt = await page.evaluate(() => (document.body?.innerText || '').slice(0, 600)).catch(() => '')
  return /performing security verification|verifies you are not a bot|cloudflare/i.test(txt)
}

/**
 * Abre a página pública de UM processo.
 * @returns {Promise<{linhas: Array<object>} | {erro: string, bloqueio?: boolean}>}
 */
async function lerProcesso(page, url) {
  await withBackoff(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }), 2)
  await page.waitForTimeout(6000)

  if (await ehDesafioDeRobo(page)) {
    return { erro: 'o portal respondeu com o desafio de robô da Cloudflare', bloqueio: true }
  }

  // Os quadros ficam no fim da página e só montam ao entrar em tela.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight)).catch(() => {})
    await page.waitForTimeout(700)
  }
  await page.waitForTimeout(1500)

  const linhas = await extrairMensagensAmm(page)
  if (linhas === null) return { erro: 'os quadros "Solicitações" e "Avisos" não apareceram na página' }
  return { linhas }
}

export async function sync({ credencial, processos = [], simulado }) {
  if (simulado) {
    const mensagens = []
    const alvos = processos.length ? processos : [{ licitacaoId: 'SIMULADO-ammlicita' }]
    for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
  }

  const todos = processos.filter((p) => urlDePesquisa(p?.urlPublica))
  const semUrl = processos.length - todos.length
  const alvos = todos.slice(0, TETO_PROCESSOS)
  const truncados = todos.length - alvos.length

  if (!alvos.length) {
    return {
      status: 'ok',
      mensagens: [],
      detalhe: `nenhum processo com página da ${META.nome} nesta passada${semUrl ? ` (${semUrl} sem link /pesquisa/)` : ''}`,
    }
  }

  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    return { status: 'falha', detalhe: 'Playwright não instalado (npx playwright install chromium)', mensagens: [] }
  }

  let browser
  const mensagens = []
  const falhas = []
  let bloqueios = 0
  let comMensagem = 0
  try {
    browser = await withBackoff(() => chromium.launch({ headless: true }))
    const context = await browser.newContext({ userAgent: UA_NAVEGADOR })
    const page = await context.newPage()

    for (const p of alvos) {
      try {
        const r = await lerProcesso(page, p.urlPublica)
        if (r.erro) {
          if (r.bloqueio) bloqueios++
          falhas.push(`${p.licitacaoId}: ${r.erro}`)
          continue
        }
        if (r.linhas.length) comMensagem++
        for (const l of r.linhas) {
          mensagens.push(
            normalizarMensagem(
              {
                autor: l.autor,
                texto: l.texto,
                horarioOrigem: horarioPorExtensoParaISO(l.horario) ?? horarioBrParaISO(l.horario),
                anexos: l.anexos,
                fonte: l.quadro,
              },
              p.licitacaoId,
            ),
          )
        }
      } catch (e) {
        falhas.push(`${p.licitacaoId}: ${String(e?.message ?? e).slice(0, 80)}`)
      }
    }
  } catch (e) {
    const msg = String(e?.message ?? e)
    try { if (browser) await browser.close() } catch { /* ignore */ }
    if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) {
      return { status: 'portal_indisponivel', detalhe: msg.slice(0, 180), mensagens: [] }
    }
    return { status: 'falha', detalhe: msg.slice(0, 180), mensagens: [] }
  } finally {
    try { if (browser) await browser.close() } catch { /* ignore */ }
  }

  // BLOQUEIO DE ROBÔ NÃO É FALHA NOSSA NEM DO CLIENTE — e não pode virar "sem novidades".
  // É o portal dizendo que não quer ser lido por máquina. Fica com estado próprio para
  // quem olha a saúde do conector saber que não há o que consertar no nosso lado.
  if (bloqueios === alvos.length) {
    return {
      status: 'portal_indisponivel',
      mensagens: [],
      detalhe: `a ${META.nome} respondeu com o desafio de robô da Cloudflare em todas as ${alvos.length} página(s) — o Radar não contorna proteção de robô`,
    }
  }

  if (falhas.length === alvos.length) {
    return {
      status: 'falha',
      mensagens: [],
      detalhe: `nenhuma das ${alvos.length} página(s) da ${META.nome} pôde ser lida — ${falhas[0]}`,
    }
  }

  const partes = [`${mensagens.length} mensagem(ns) em ${comMensagem}/${alvos.length} processo(s)`]
  if (falhas.length) partes.push(`${falhas.length} página(s) não lida(s)`)
  if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
  partes.push('solicitações e avisos públicos (a sala ao vivo exige a sessão do fornecedor)')

  return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
}
