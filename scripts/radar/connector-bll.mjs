// scripts/radar/connector-bll.mjs — conector do BLL e do BNC (MODO PÚBLICO, sem login).
//
// UM conector para DOIS portais porque é literalmente o mesmo sistema: bllcompras.com e
// bnccompras.com servem a mesma aplicação ASP.NET, com a mesma rota
// (/Process/ProcessView?param1=[gkz]…), as mesmas abas e o MESMO DOM de mensagens.
// Medido em 13/09/2026 nos dois domínios, sem cookie nenhum.
//
// COMO O CHAT É LIDO (calibrado contra páginas reais, não adivinhado):
//   1. a página do processo é pública — abre sem sessão;
//   2. a aba "Mensagens" é um <button> que abre um modal e dispara
//      GET /BatchList/GetProcessMessageView?param1=… ;
//   3. o modal, por sua vez, faz POST /BatchList/GetProcessMessageList?param1=… e
//      injeta as linhas em `tbody#MsgProcess`;
//   4. cada linha é `<td class="datetimesecwidth">DD/MM/YYYY HH:MM:SS</td><td>texto</td>`.
//
// O `param1` do passo 2 NÃO é o da URL do processo — é outro token, gerado pela página.
// Por isso o conector clica na aba em vez de montar a URL do endpoint na mão: chamar o
// endpoint direto exigiria forjar o token, e isso quebra no primeiro deploy deles.
//
// O QUE ESTE CONECTOR VÊ: o log público do processo — arquivo adicionado/removido,
// troca de pregoeiro, alteração de intervalo de lances, suspensão/retomada, prazos.
// É o que o portal publica para QUALQUER UM, inclusive para quem ainda não disputa —
// diferente do Compras.gov.br, onde só se enxerga o que a empresa já participa.
//
// O QUE ELE NÃO VÊ: a sala de disputa AO VIVO (lances e negociação em tempo real),
// que exige a sessão do próprio fornecedor. Fica explícito no `detalhe`, nunca escondido.
//
// HONESTIDADE (requisito 4.2): `#MsgProcess` VAZIO é resposta ("ainda não há mensagem");
// `#MsgProcess` que não aparece é FALHA. Os dois casos são contados e ditos separadamente.

import { SIMULADO_FIXTURES, horarioBrParaISO, normalizarMensagem, withBackoff } from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Teto de páginas por passada. Não é timidez: o BLL+BNC respondem por ~6,3 mil
// contratações de saúde em 180 dias, e cada processo custa ~12 s de navegador. Sem teto,
// uma passada de 2 h não termina — e um portal que recebe milhares de hits seguidos de
// um mesmo IP trata isso como ataque, com razão. O worker manda os processos JÁ
// ordenados por urgência (sessão mais próxima primeiro), então o teto corta a cauda,
// não o que importa. Truncamento é DITO no detalhe, nunca silencioso.
const TETO_PROCESSOS = 60

/**
 * A URL é uma página de PROCESSO deste portal (e não um link solto do PNCP)?
 *
 * `/DirectBuy/` fica DE FORA de propósito. A compra direta é outra tela: medido em
 * 13/09/2026 em três páginas (BLL e BNC), ela simplesmente não tem a aba "Mensagens" —
 * não é chat vazio, é chat inexistente. São ~2,1 mil links da base; aceitá-los encheria
 * a saúde do conector de falhas permanentes que ninguém pode consertar. `ehCompraDireta`
 * separa esse caso para ele aparecer como o que é.
 */
export function urlDeProcesso(url, dominio) {
  const u = String(url ?? '')
  return u.toLowerCase().includes(dominio) && /\/Process\//i.test(u)
}

/** Compra direta do BLL/BNC: página pública, mas sem quadro de mensagens. */
export function ehCompraDireta(url, dominio) {
  const u = String(url ?? '')
  return u.toLowerCase().includes(dominio) && /\/DirectBuy\//i.test(u)
}

/**
 * Lê as linhas já injetadas em `tbody#MsgProcess`.
 * Devolve `null` quando o tbody NÃO existe — que é diferente de existir vazio, e é
 * essa diferença que separa "sem mensagens" de "não consegui ler".
 */
export async function extrairMensagensBll(page) {
  return page.evaluate(() => {
    const tb = document.querySelector('#MsgProcess')
    if (!tb) return null
    const out = []
    for (const tr of tb.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td')
      if (tds.length < 2) continue
      const horario = (tds[0].innerText || '').replace(/\s+/g, ' ').trim()
      const texto = (tds[1].innerText || '').replace(/\s+/g, ' ').trim()
      if (!texto) continue
      out.push({ texto, horario })
    }
    return out
  })
}

/**
 * Abre a página pública de UM processo e devolve as mensagens.
 * @returns {Promise<{linhas: Array<{texto:string,horario:string}>} | {erro: string}>}
 */
async function lerProcesso(page, url) {
  await withBackoff(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }), 2)
  // A aba só existe depois que o ASP.NET monta o cabeçalho do processo.
  const aba = page.locator('button', { hasText: /^Mensagens$/i }).first()
  try {
    await aba.waitFor({ state: 'visible', timeout: 15000 })
  } catch {
    return { erro: 'a aba "Mensagens" não apareceu na página' }
  }
  await aba.click({ timeout: 10000 })
  // O modal carrega em dois saltos (view e depois a lista). Esperar o tbody EXISTIR é
  // mais fiel do que esperar um tempo fixo: quando não há mensagem, o tbody aparece
  // vazio — e é essa a resposta que queremos poder afirmar.
  try {
    await page.waitForSelector('#MsgProcess', { state: 'attached', timeout: 15000 })
  } catch {
    return { erro: 'o quadro de mensagens não carregou (modal não abriu)' }
  }
  // Pequena folga para o POST da lista devolver e preencher o tbody recém-criado.
  await page.waitForTimeout(3000)
  const linhas = await extrairMensagensBll(page)
  if (linhas === null) return { erro: 'o quadro de mensagens sumiu antes da leitura' }
  return { linhas }
}

/**
 * Fábrica do conector. BLL e BNC compartilham tudo menos o id/nome/domínio.
 * @param {{ id: 'bll' | 'bnc' }} meta
 */
export function criarConectorBllBnc({ id }) {
  const META = portalMeta(id)
  const DOMINIO = META.dominio

  return async function sync({ credencial, processos = [], simulado }) {
    if (simulado) {
      const mensagens = []
      const alvos = processos.length ? processos : [{ licitacaoId: `SIMULADO-${id}` }]
      for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
      return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
    }

    // Só processos cuja URL é mesmo deste portal. Um link do PNCP ou de outro portal
    // aqui viraria uma navegação inútil e um erro que não diz nada.
    const todos = processos.filter((p) => urlDeProcesso(p?.urlPublica, DOMINIO))
    const diretas = processos.filter((p) => ehCompraDireta(p?.urlPublica, DOMINIO)).length
    const semUrl = processos.length - todos.length - diretas
    const alvos = todos.slice(0, TETO_PROCESSOS)
    const truncados = todos.length - alvos.length

    if (!alvos.length) {
      return {
        status: 'ok',
        mensagens: [],
        detalhe: `nenhum processo com página do ${META.nome} nesta passada${semUrl ? ` · ${semUrl} sem link do portal` : ''}${diretas ? ` · ${diretas} compra(s) direta(s), que não têm quadro de mensagens` : ''}`,
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
    let comMensagem = 0
    try {
      browser = await withBackoff(() => chromium.launch({ headless: true }))
      const context = await browser.newContext({ userAgent: UA_NAVEGADOR })
      const page = await context.newPage()

      for (const p of alvos) {
        try {
          const r = await lerProcesso(page, p.urlPublica)
          if (r.erro) { falhas.push(`${p.licitacaoId}: ${r.erro}`); continue }
          if (r.linhas.length) comMensagem++
          for (const l of r.linhas) {
            mensagens.push(
              normalizarMensagem(
                {
                  // O portal não nomeia o autor destas linhas: são o log do processo,
                  // escrito pelo próprio sistema sobre os atos do condutor. Inventar
                  // "Pregoeiro" aqui seria atribuir fala a alguém — então fica "Sistema",
                  // que é o que de fato assina.
                  autor: 'Sistema',
                  texto: l.texto,
                  horarioOrigem: horarioBrParaISO(l.horario),
                  horarioBr: l.horario,
                  fonte: 'log público do processo',
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
      try { if (browser) await browser.close() } catch { /* ignore */ }
      const msg = String(e?.message ?? e)
      if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) {
        return { status: 'portal_indisponivel', detalhe: msg.slice(0, 180), mensagens: [] }
      }
      return { status: 'falha', detalhe: msg.slice(0, 180), mensagens: [] }
    } finally {
      try { if (browser) await browser.close() } catch { /* ignore */ }
    }

    // TODAS as páginas falharam = o portal mudou (ou caiu). Isso NÃO pode virar "ok com
    // 0 mensagens": é exatamente o silêncio que o cliente leria como "sem novidades".
    if (falhas.length === alvos.length) {
      return {
        status: 'falha',
        mensagens: [],
        detalhe: `nenhuma das ${alvos.length} página(s) do ${META.nome} pôde ser lida — ${falhas[0]}`,
      }
    }

    const partes = [`${mensagens.length} mensagem(ns) em ${comMensagem}/${alvos.length} processo(s)`]
    if (falhas.length) partes.push(`${falhas.length} página(s) não lida(s)`)
    if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
    if (diretas) partes.push(`${diretas} compra(s) direta(s) sem quadro de mensagens`)
    // Dito sempre, para ninguém confundir o log público com a sala de disputa.
    partes.push('log público (a sala ao vivo exige a sessão do fornecedor)')
    if (credencial?.storageState) partes.push('sessão salva ainda não usada por este portal')

    return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
  }
}

export const sync = criarConectorBllBnc({ id: 'bll' })
