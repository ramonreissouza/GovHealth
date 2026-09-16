// scripts/radar/connector-egovrs.mjs — conector do eGov RS (MODO PÚBLICO, sem login).
//
// Atende DOIS ids do catálogo, `egovrs` e `banrisul`, porque é a mesma aplicação em dois
// domínios — exatamente o caso do BLL/BNC. O Pregão Banrisul é a fachada usada por
// municípios gaúchos; o Compras RS é a do próprio Estado. As duas publicam o edital na
// mesma rota (`/editais/<numero>_<ano>/<idOffer>`) e o link do Banrisul aponta, na
// própria página, para `compras.rs.gov.br/egov2/...`. Os ids ficam separados só para o
// cliente ler o nome do portal onde o pregão realmente corre.
//
// O QUE ENTRA POR AQUI: a ATA DE ESCLARECIMENTOS E IMPUGNAÇÕES, que é pública e completa.
// Não é aviso de que houve pergunta — é a pergunta inteira, a resposta inteira, quem
// respondeu, quando, e no caso de impugnação o JULGAMENTO (Negado/Deferido). Medido em
// 15/09/2026 no edital 0038/2026 de Veranópolis/RS (5 esclarecimentos + 3 impugnações):
//
//   "esclarece-se que a apresentação isolada de certificado de pós-graduação lato sensu
//    não será aceita como comprovação da condição de médico especialista"
//   "os serviços de Enfermeiro e Técnico de Enfermagem foram desmembrados do objeto (…)
//    e passaram a compor procedimento licitatório próprio (Pregão Eletrônico nº 039/2026)"
//
// Isso muda proposta. É o conteúdo mais decisivo dos portais públicos ligados até aqui.
//
// ── NÃO USA NAVEGADOR, E ISSO É O PONTO ─────────────────────────────────────────────
// A página é HTML servido pronto (JSP antigo, tabelas com bgcolor). Um `fetch` basta.
// Os outros conectores públicos custam ~12 s por processo porque precisam do Playwright
// esperar o Vue montar; aqui é ~0,5 s. Por isso o teto é 400 e não 60: o gargalo deixou
// de ser o navegador e passou a ser a educação com o portal (o `PAUSA_MS` abaixo).
//
// ── O QUE ESTE CONECTOR SE RECUSA A LER ─────────────────────────────────────────────
// A mesma página oferece "Ata Eletrônica" em `acessarAtaEletronica.ctlx`, que traria a
// sessão de lances inteira. Ela está atrás de uma validação que o próprio portal explica:
// "Esta validação ajuda o Portal de Compras a evitar consultas por programas automáticos
// (robôs)". É um desafio anti-robô, e o Radar não contorna desafio anti-robô (requisito
// 4.2 + termos de uso) — foi o mesmo motivo de o Licitar Digital ter ficado de fora. Só
// a ata de esclarecimentos entra, e ela é aberta: 37 de 37 processos sondados
// responderam 200 sem cookie, sem `siteContext` e sem nenhuma validação.
//
// ── POR QUE PERGUNTA E RESPOSTA SÃO MENSAGENS SEPARADAS ─────────────────────────────
// O dedup é `sha256(conector, licitação, autor, texto, horário)`. Se pergunta e resposta
// fossem uma mensagem só, o pedido ainda sem resposta entraria com um texto, e quando
// respondido o texto MUDARIA — hash novo, e o cliente receberia a pergunta de novo junto
// com a resposta. Separadas, a pergunta entra uma vez e depois chega só a resposta, que
// é a novidade. O `Situação:` fica de fora do texto da pergunta pelo mesmo motivo: ele
// muda de "Aguardando" para "Respondido" e ressuscitaria a pergunta inteira.
//
// ── A ARMADILHA DO PARSER ───────────────────────────────────────────────────────────
// O texto plano NÃO serve para achar as fronteiras dos registros. Os anexos se chamam
// "Resposta" e "PEDIDO DE IMPUGNAÇÃO" — os mesmos nomes dos marcadores —, e um anexo
// chamado "Pedido de impugnação" abriria um registro fantasma no meio do anterior. As
// fronteiras vêm da ESTRUTURA, que é estável e explícita: `<tr bgcolor="#dddddd">` abre
// um pedido, `<tr bgcolor="#efefef">` marca protocolo e resposta, e os campos são
// sempre `<b>Rótulo:</b> valor</td>`. Anexo é `<a>`, nunca `<b>` — e é isso que os
// separa sem ambiguidade.

import { SIMULADO_FIXTURES, normalizarMensagem, horarioBrParaISO, withBackoff } from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

/** Host canônico da aplicação: o Banrisul é fachada, o egov2 é quem serve a ata. */
const BASE_ATA = 'https://www.compras.rs.gov.br/egov2/offer/offerPetition/electronicRecord.ctlx'

// Sem navegador, cada processo custa um GET. O teto existe para a passada não virar uma
// varredura, e é generoso de propósito — ver o cabeçalho.
const TETO_PROCESSOS = 400
const PAUSA_MS = 350
const TIMEOUT_MS = 25000

/**
 * O `idOffer` do edital, extraído do link que o PNCP publica.
 * Os dois domínios usam a MESMA forma: /editais/<numero>_<ano>/<idOffer>.
 */
export function idDoEdital(url) {
  const m = String(url ?? '').match(/\/editais\/[^/]+\/(\d+)/)
  return m ? m[1] : null
}

/** A URL é de um edital do eGov RS (Compras RS ou Pregão Banrisul)? */
export function urlDeEdital(url) {
  const u = String(url ?? '')
  return /(compras\.rs\.gov\.br|pregaobanrisul\.com\.br)/i.test(u) && idDoEdital(u) !== null
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' }

function limpar(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Valor de um campo `<b>Rótulo:</b> valor</td>` dentro de um pedaço de HTML. */
function campo(bloco, rotulo) {
  const re = new RegExp(`<b>\\s*${rotulo}\\s*:?\\s*</b>([\\s\\S]*?)</td>`, 'i')
  const m = bloco.match(re)
  return m ? limpar(m[1]) || null : null
}

/** Nomes dos anexos (links de download) de um pedaço de HTML. */
function anexos(bloco) {
  const out = []
  for (const m of bloco.matchAll(/<a[^>]+href="([^"]*download\.ctlx[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const nome = limpar(m[2])
    if (nome) out.push({ nome, url: m[1].replace(/&amp;/g, '&') })
  }
  return out
}

/**
 * Lê a ata e devolve os pedidos registrados.
 *
 * Devolve `null` quando a página NÃO é uma ata — e essa diferença é a regra de ouro do
 * requisito 4.2. "Não foram registrados pedidos" é uma LEITURA que deu vazio, e vale
 * como "sem novidades"; uma página de erro, um redirecionamento ou um HTML que mudou de
 * forma NÃO valem, e não podem ser reportados como 'ok'.
 */
export function extrairAta(html) {
  const s = String(html ?? '').replace(/\s+/g, ' ')
  if (!/ATA DE ESCLARECIMENTOS E IMPUGNA/i.test(s)) return null

  const iEscl = s.search(/<b>\s*ESCLARECIMENTOS\s*<\/b>/i)
  const iImp = s.search(/<b>\s*IMPUGNA[^<]*<\/b>/i)

  const pedidos = []
  // As fronteiras: cada `<tr bgcolor="#dddddd">` abre um pedido e vai até o próximo.
  const aberturas = [...s.matchAll(/<tr\s+bgcolor="#dddddd"[^>]*>/gi)].map((m) => m.index)
  for (let i = 0; i < aberturas.length; i++) {
    const ini = aberturas[i]
    const bloco = s.slice(ini, aberturas[i + 1] ?? s.length)

    const tipoM = bloco.match(/<b>\s*Pedido de (esclarecimento|impugna[^<]*)\s*<\/b>/i)
    if (!tipoM) continue
    const tipo = /impugna/i.test(tipoM[1]) ? 'impugnacao' : 'esclarecimento'

    // A resposta começa no `<b>Resposta</b>` — que é negrito. O anexo chamado
    // "Resposta" é `<a>`, e por isso não casa aqui.
    const iResp = bloco.search(/<tr\s+bgcolor="#efefef"[^>]*>\s*<td>\s*<b>\s*Resposta\s*<\/b>/i)
    const partePedido = iResp >= 0 ? bloco.slice(0, iResp) : bloco
    const parteResposta = iResp >= 0 ? bloco.slice(iResp) : ''

    const protocolo = (partePedido.match(/<b>\s*Protocolo\s+(\d+)\s*<\/b>/i) || [])[1] ?? null

    pedidos.push({
      tipo,
      // Antes do cabeçalho de IMPUGNAÇÕES é esclarecimento; o `tipo` do próprio
      // registro já diz, e a posição serve só de conferência.
      secao: iImp >= 0 && ini > iImp ? 'impugnacoes' : iEscl >= 0 ? 'esclarecimentos' : null,
      protocolo,
      situacao: campo(partePedido, 'Situa[çc][ãa]o'),
      dataPedido: campo(partePedido, 'Data do pedido'),
      solicitacao: campo(partePedido, 'Solicita[çc][ãa]o'),
      anexosPedido: anexos(partePedido),
      resposta: iResp < 0 ? null : {
        data: campo(parteResposta, 'Data'),
        julgamento: campo(parteResposta, 'Julgamento'),
        responsavel: campo(parteResposta, 'Respons[áa]vel'),
        texto: campo(parteResposta, 'Texto'),
        anexos: anexos(parteResposta),
      },
    })
  }
  return pedidos
}

const ROTULO = { esclarecimento: 'Esclarecimento', impugnacao: 'Impugnação' }

/** Um pedido vira uma ou duas mensagens (a pergunta e, se houver, a resposta). */
export function mensagensDoPedido(p, licitacaoId) {
  const out = []
  const marca = `[${ROTULO[p.tipo]}${p.protocolo ? ` nº ${p.protocolo}` : ''}]`

  // O texto da pergunta pode ser só "Pedido de impugnação" com o conteúdo no anexo —
  // acontece o tempo todo. Dizer que há um anexo é a diferença entre o cliente saber
  // que existe algo para abrir e achar que a impugnação estava vazia.
  const pedidoTexto = [p.solicitacao, anexoResumo(p.anexosPedido)].filter(Boolean).join(' ')
  if (pedidoTexto) {
    out.push({
      autor: `${ROTULO[p.tipo]} — pedido`,
      texto: `${marca} — ${pedidoTexto}`.trim(),
      horarioOrigem: horarioBrParaISO(p.dataPedido),
      anexos: p.anexosPedido.map((a) => a.nome),
      raw: { tipo: p.tipo, protocolo: p.protocolo, lado: 'pedido', situacao: p.situacao, anexos: p.anexosPedido },
    })
  }

  if (p.resposta) {
    const r = p.resposta
    // O JULGAMENTO vai na frente do texto de propósito: numa impugnação ele é a única
    // coisa que o fornecedor precisa ler para saber se o edital mudou ou não.
    //
    // `Situação` só entra quando NÃO há julgamento e ela diz algo além do óbvio. Existir
    // uma resposta já prova que foi respondido, então "Situação: Respondido" seria ruído
    // em toda mensagem — e, pior, um campo que ainda pode mudar dentro de um texto que
    // entra no hash: mudou a situação, a resposta inteira voltaria como novidade.
    const veredito = r.julgamento
      ? `Julgamento: ${r.julgamento}`
      : p.situacao && !/^respondid/i.test(p.situacao) ? `Situação: ${p.situacao}` : null
    const corpo = [r.texto, anexoResumo(r.anexos)].filter(Boolean).join(' ')
    if (veredito || corpo) {
      out.push({
        autor: r.responsavel ? `${ROTULO[p.tipo]} — resposta de ${r.responsavel}` : `${ROTULO[p.tipo]} — resposta`,
        texto: [marca, veredito, corpo].filter(Boolean).join(' — ').trim(),
        horarioOrigem: horarioBrParaISO(r.data),
        anexos: r.anexos.map((a) => a.nome),
        raw: { tipo: p.tipo, protocolo: p.protocolo, lado: 'resposta', julgamento: r.julgamento, responsavel: r.responsavel, anexos: r.anexos },
      })
    }
  }
  return out
}

function anexoResumo(lista) {
  if (!lista?.length) return null
  return `(documento anexado: ${lista.map((a) => a.nome).join(', ')})`
}

async function lerAta(idOffer) {
  const res = await withBackoff(
    () => fetch(`${BASE_ATA}?idOfferFiltered=${encodeURIComponent(idOffer)}`, {
      headers: { 'user-agent': UA_NAVEGADOR, accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    2,
  )
  if (!res.ok) return { erro: `HTTP ${res.status}` }
  const html = await res.text()
  const pedidos = extrairAta(html)
  // A distinção que o requisito 4.2 exige: não é "veio vazio", é "não é a ata".
  if (pedidos === null) return { erro: 'a resposta não é a ata de esclarecimentos (o portal mudou ou devolveu outra página)' }
  return { pedidos }
}

export async function sync({ credencial, processos = [], simulado, conectorId = 'egovrs' }) {
  const META = portalMeta(conectorId)

  if (simulado) {
    const mensagens = []
    const alvos = processos.length ? processos : [{ licitacaoId: `SIMULADO-${conectorId}` }]
    for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
  }

  const todos = processos.filter((p) => urlDeEdital(p?.urlPublica))
  const semUrl = processos.length - todos.length
  const alvos = todos.slice(0, TETO_PROCESSOS)
  const truncados = todos.length - alvos.length

  if (!alvos.length) {
    return {
      status: 'ok',
      mensagens: [],
      detalhe: `nenhum processo com edital do ${META.nome} nesta passada${semUrl ? ` (${semUrl} sem link /editais/)` : ''}`,
    }
  }

  const mensagens = []
  const falhas = []
  let comConteudo = 0
  let redeMorta = 0

  for (const p of alvos) {
    const id = idDoEdital(p.urlPublica)
    try {
      const r = await lerAta(id)
      if (r.erro) { falhas.push(`${p.licitacaoId}: ${r.erro}`); continue }
      if (r.pedidos.length) comConteudo++
      for (const ped of r.pedidos) {
        for (const m of mensagensDoPedido(ped, p.licitacaoId)) mensagens.push(normalizarMensagem(m, p.licitacaoId))
      }
    } catch (e) {
      const msg = String(e?.message ?? e)
      if (/timeout|abort|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(msg)) redeMorta++
      falhas.push(`${p.licitacaoId}: ${msg.slice(0, 80)}`)
    }
    await new Promise((r) => setTimeout(r, PAUSA_MS))
  }

  // Todas falharam por rede = o portal está fora, não é falha nossa nem do dado. A
  // distinção importa porque 'portal_indisponivel' NÃO zera a saúde do conector na tela.
  if (falhas.length === alvos.length) {
    if (redeMorta === alvos.length) {
      return { status: 'portal_indisponivel', mensagens: [], detalhe: `${META.nome} não respondeu em nenhuma das ${alvos.length} tentativa(s)` }
    }
    return { status: 'falha', mensagens: [], detalhe: `nenhuma das ${alvos.length} ata(s) do ${META.nome} pôde ser lida — ${falhas[0]}` }
  }

  const partes = [`${mensagens.length} mensagem(ns) em ${comConteudo}/${alvos.length} processo(s)`]
  if (falhas.length) partes.push(`${falhas.length} ata(s) não lida(s)`)
  if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
  partes.push('ata pública de esclarecimentos e impugnações')

  return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
}

/** O mesmo conector, amarrado ao id do portal (o registry precisa de um por id). */
export const syncEgovRs = (args) => sync({ ...args, conectorId: 'egovrs' })
export const syncBanrisul = (args) => sync({ ...args, conectorId: 'banrisul' })
