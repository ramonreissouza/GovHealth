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

import {
  abrirPagina,
  horarioBrParaISO,
  normalizarMensagem,
  PortalRecusou,
  SIMULADO_FIXTURES,
  withBackoff,
} from './connector-base.mjs'
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
 * O clique na aba "Mensagens" só funciona depois que o script do reCAPTCHA terminou de
 * carregar. Medido em 18/09/2026, navegador frio, três páginas (duas do BLL, uma do BNC):
 *
 *   4,9 s  domcontentloaded — `doAction` e jQuery JÁ existem, `grecaptcha.execute` NÃO
 *   7,1 s  `grecaptcha.execute` vira função
 *   9,2 s  readyState = complete
 *
 * O conector clicava aos 4,94 s. `doAction` chama `grecaptcha.execute(...)`, que aos
 * 4,9 s ainda é `undefined`: o clique morria ali, SEM UMA ÚNICA REQUISIÇÃO — e o
 * conector, vendo o tbody ausente, dizia "o modal não abriu". 3 de 3 páginas frias
 * falharam; as mesmas 3, quentes, leram 57, 68 e 14 linhas.
 *
 * É por isso que a falha parecia intermitente e caprichosa: só a PRIMEIRA página de cada
 * passada é fria. No BNC ela se escondia no meio das outras (o conector tolera falha
 * parcial); no BLL, que teve 1 processo na passada, a primeira era a única — e a passada
 * inteira virava `falha`.
 *
 * ISTO NÃO CONTORNA CAPTCHA (requisito 4.2 + ToS). Não há desafio a resolver: é o
 * reCAPTCHA v3, invisível, do próprio portal. Só esperamos o portal terminar de carregar
 * antes de apertar o botão dele — o oposto de burlar.
 */
const BOOTSTRAP_TIMEOUT_MS = 20000

/**
 * Espera o portal ficar pronto para receber o clique. Melhor-esforço de propósito: se
 * um dia o BLL sair do reCAPTCHA, `grecaptcha` nunca aparece e travar aqui transformaria
 * uma página que LÊ numa falha. Quem decide é o resultado do clique, não esta espera.
 */
export async function esperarBootstrap(page, timeout = BOOTSTRAP_TIMEOUT_MS) {
  try {
    await page.waitForFunction(() => typeof window.grecaptcha?.execute === 'function', null, { timeout })
    return true
  } catch {
    return false
  }
}

/**
 * Espera curta depois que o portal PROVOU não precisar do bootstrap.
 *
 * Sem memória, um BLL sem reCAPTCHA custaria os 20 s inteiros em CADA página: 60 × 20 s
 * = 20 min a mais por tenant, numa passada sequencial. Só que "o grecaptcha não veio"
 * sozinho não prova nada — pode ser só uma rede lenta na primeira página, e aí cortar a
 * espera faria todas as seguintes clicarem cedo demais (o defeito original). A prova é
 * o par: a espera estourou E a leitura deu certo mesmo assim. Só então a espera encolhe.
 */
const BOOTSTRAP_DISPENSADO_MS = 2000

/**
 * Estado compartilhado entre as páginas de UMA passada (um navegador).
 * @returns {{ bootstrapDispensavel: boolean }}
 */
export function novoEstadoLeitura() {
  return { bootstrapDispensavel: false }
}

/**
 * Hosts aceitos, por extenso. NÃO é `includes(dominio)`: com substring passavam
 * `https://bllcompras.com.exemplo.net/Process/x` e `http://127.0.0.1/Process/bllcompras.com`
 * — e a URL vai direto para `page.goto`, ou seja, o worker navegaria para onde o link
 * mandasse, inclusive para a rede interna dele (SSRF).
 *
 * Medido no banco em 25/09/2026: os 332 links de BLL/BNC em radar_processos são todos
 * `https://bllcompras.com` ou `https://bnccompras.com`. O `www.` entra só por ser o mesmo
 * site (nenhum link medido usa); qualquer outro subdomínio fica de fora até aparecer.
 */
export const HOSTS_PORTAL = {
  bll: ['bllcompras.com', 'www.bllcompras.com'],
  bnc: ['bnccompras.com', 'www.bnccompras.com'],
}

/**
 * Devolve a URL parseada se ela é HTTPS, sem credencial embutida, na porta padrão e com
 * o hostname EXATAMENTE numa lista explícita. Qualquer outra coisa: null.
 */
export function urlDoPortal(url, hosts) {
  let u
  try { u = new URL(String(url ?? '')) } catch { return null }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  // `new URL` já normaliza :443 para ''. Qualquer porta que sobre é outro serviço.
  if (u.port) return null
  if (!hosts.includes(u.hostname.toLowerCase())) return null
  return u
}

/**
 * A URL é uma página de PROCESSO deste portal (e não um link solto do PNCP)?
 *
 * `/DirectBuy/` fica DE FORA de propósito. A compra direta é outra tela: medido em
 * 13/09/2026 em três páginas (BLL e BNC), ela simplesmente não tem a aba "Mensagens" —
 * não é chat vazio, é chat inexistente. São ~2,1 mil links da base; aceitá-los encheria
 * a saúde do conector de falhas permanentes que ninguém pode consertar. `ehCompraDireta`
 * separa esse caso para ele aparecer como o que é.
 */
export function urlDeProcesso(url, hosts) {
  const u = urlDoPortal(url, hosts)
  return !!u && /^\/Process\//i.test(u.pathname)
}

/** Compra direta do BLL/BNC: página pública, mas sem quadro de mensagens. */
export function ehCompraDireta(url, hosts) {
  const u = urlDoPortal(url, hosts)
  return !!u && /^\/DirectBuy\//i.test(u.pathname)
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
export async function lerProcesso(page, url, estado = novoEstadoLeitura()) {
  // `abrirPagina` (e não `page.goto` cru) porque goto NÃO lança em 403: sem olhar o
  // status, uma recusa do portal chegaria aqui disfarçada de "a aba não apareceu".
  await abrirPagina(page, url, { timeout: 45000, tentativas: 2 })

  // A aba só existe depois que o ASP.NET monta o cabeçalho do processo.
  const aba = page.locator('button', { hasText: /^Mensagens$/i }).first()
  try {
    await aba.waitFor({ state: 'visible', timeout: 15000 })
  } catch {
    return { erro: 'a aba "Mensagens" não apareceu na página' }
  }

  // Visível ≠ pronta. Ver o comentário de BOOTSTRAP_TIMEOUT_MS.
  const pronto = await esperarBootstrap(page, estado.bootstrapDispensavel ? BOOTSTRAP_DISPENSADO_MS : BOOTSTRAP_TIMEOUT_MS)
  // Veio o grecaptcha: o portal voltou a depender dele, e a espera volta ao tamanho cheio.
  if (pronto) estado.bootstrapDispensavel = false

  // O modal carrega em dois saltos (view e depois a lista). Esperar o tbody EXISTIR é
  // mais fiel do que esperar um tempo fixo: quando não há mensagem, o tbody aparece
  // vazio — e é essa a resposta que queremos poder afirmar.
  const esperarQuadro = async (timeout) => {
    try {
      await page.waitForSelector('#MsgProcess', { state: 'attached', timeout })
      return true
    } catch {
      return false
    }
  }

  await aba.click({ timeout: 10000 })
  let abriu = await esperarQuadro(15000)

  if (!abriu) {
    // Duas coisas muito diferentes cabem aqui, e tratá-las igual estraga uma delas:
    // o modal ABERTO e lento só precisa de mais tempo — reclicar nele fecharia o que
    // estava quase pronto. Já o clique que MORREU não deixa modal nenhum, e só um
    // segundo clique o traz de volta.
    const modalAberto = await page.evaluate(() => !!document.querySelector('.genModal.show, .modal.show'))
    if (modalAberto) {
      abriu = await esperarQuadro(10000)
    } else {
      await aba.click({ timeout: 10000 })
      abriu = await esperarQuadro(15000)
    }
  }

  if (!abriu) return { erro: 'o quadro de mensagens não carregou (modal não abriu)' }

  // Pequena folga para o POST da lista devolver e preencher o tbody recém-criado.
  await page.waitForTimeout(3000)
  const linhas = await extrairMensagensBll(page)
  if (linhas === null) return { erro: 'o quadro de mensagens sumiu antes da leitura' }
  // A espera estourou e a leitura deu certo assim mesmo: agora SIM está provado que este
  // portal não precisa do bootstrap. Ver BOOTSTRAP_DISPENSADO_MS.
  if (!pronto) estado.bootstrapDispensavel = true
  return { linhas }
}

/**
 * Decide o status da passada a partir do que foi lido. Separado do `sync` para ser
 * testado sem navegador: é aqui que mora a regra "parcial não é ok".
 */
export function resultadoDaPassada({ nome, alvos, mensagens, falhas, comMensagem, recusa, truncados, diretas, credencial }) {
  // O portal fechou a porta. Não é "falha do conector" nem "sem novidades": é uma
  // terceira coisa, e dizer qual poupa quem lê de caçar um seletor que está correto.
  if (recusa) {
    const lidas = mensagens.length ? ` · ${mensagens.length} mensagem(ns) lida(s) antes disso` : ''
    return {
      status: 'portal_indisponivel',
      mensagens,
      detalhe: `o ${nome} recusou a conexão (HTTP ${recusa.status}) — parei na 1ª recusa para não insistir contra o bloqueio${lidas}`,
    }
  }

  // TODAS as páginas falharam = o portal mudou (ou caiu). Isso NÃO pode virar "ok com
  // 0 mensagens": é exatamente o silêncio que o cliente leria como "sem novidades".
  if (falhas.length === alvos.length) {
    return {
      status: 'falha',
      mensagens: [],
      detalhe: `nenhuma das ${alvos.length} página(s) do ${nome} pôde ser lida — ${falhas[0]}`,
    }
  }

  const partes = [`${mensagens.length} mensagem(ns) em ${comMensagem}/${alvos.length} processo(s)`]
  // COM O MOTIVO. "1 página não lida" e mais nada é o mesmo pecado do diagnóstico
  // errado, só que menor: quem lê a saúde não tem como saber se foi o portal, a
  // página ou o conector — e sem isso ninguém investiga uma falha parcial.
  if (falhas.length) partes.push(`${falhas.length} página(s) não lida(s) — ${falhas[0]}`)
  if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
  if (diretas) partes.push(`${diretas} compra(s) direta(s) sem quadro de mensagens`)
  // Dito sempre, para ninguém confundir o log público com a sala de disputa.
  partes.push('log público (a sala ao vivo exige a sessão do fornecedor)')
  if (credencial?.storageState) partes.push('sessão salva ainda não usada por este portal')

  // LEITURA PARCIAL NÃO É `ok`. Com `ok`, 59 páginas perdidas e 1 lida deixavam o
  // conector verde e avançavam `verificado_em` — e a tela então afirmava "sem
  // novidades" sobre páginas que ninguém abriu, onde podia estar uma convocação.
  // É o requisito 4.2 ao pé da letra.
  //
  // `falha`, e não um status novo: `falha` já é "não verificado" em toda a cadeia
  // (verificado_em fica parado, a UI não afirma nada). As mensagens lidas SEGUEM —
  // o orquestrador grava o que veio qualquer que seja o status — e o detalhe diz que
  // foi parcial e por quê, para ninguém confundir com o portal fora do ar.
  if (falhas.length) {
    return {
      status: 'falha',
      mensagens,
      detalhe: `leitura parcial: ${alvos.length - falhas.length} de ${alvos.length} página(s) lida(s) · ${partes.join(' · ')}`,
    }
  }

  return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
}

/**
 * Fábrica do conector. BLL e BNC compartilham tudo menos o id/nome/domínio.
 * @param {{ id: 'bll' | 'bnc' }} meta
 */
export function criarConectorBllBnc({ id }) {
  const META = portalMeta(id)
  const HOSTS = HOSTS_PORTAL[id]
  if (!HOSTS) throw new Error(`connector-bll: sem lista de hosts para "${id}" (ver HOSTS_PORTAL)`)

  return async function sync({ credencial, processos = [], simulado }) {
    if (simulado) {
      const mensagens = []
      const alvos = processos.length ? processos : [{ licitacaoId: `SIMULADO-${id}` }]
      for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
      return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
    }

    // Só processos cuja URL é mesmo deste portal. Um link do PNCP ou de outro portal
    // aqui viraria uma navegação inútil e um erro que não diz nada.
    const todos = processos.filter((p) => urlDeProcesso(p?.urlPublica, HOSTS))
    const diretas = processos.filter((p) => ehCompraDireta(p?.urlPublica, HOSTS)).length
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
    let recusa = null
    try {
      browser = await withBackoff(() => chromium.launch({ headless: true }))
      const context = await browser.newContext({ userAgent: UA_NAVEGADOR })
      const page = await context.newPage()
      const estadoLeitura = novoEstadoLeitura()

      for (const p of alvos) {
        try {
          const r = await lerProcesso(page, p.urlPublica, estadoLeitura)
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
          // Recusa é sobre o PORTAL, não sobre este processo: continuar a fila só
          // renovaria o bloqueio, e cada página seguinte daria a mesma falha genérica.
          if (e instanceof PortalRecusou) { recusa = e; break }
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

    return resultadoDaPassada({ nome: META.nome, alvos, mensagens, falhas, comMensagem, recusa, truncados, diretas, credencial })
  }
}

export const sync = criarConectorBllBnc({ id: 'bll' })
