// scripts/radar/connector-licitacoes-e.mjs — conector do LICITAÇÕES-E (Banco do Brasil),
// MODO PÚBLICO, pela API REST do portal NOVO. Sem login, sem navegador.
//
// POR QUE O PORTAL ANTIGO FICOU PARA TRÁS
//
// `www.licitacoes-e.com.br/aop/index-login.aop` está morto para nós, e não por
// seletor: a página de login é servida atrás do Módulo de Segurança do BB (Warsaw /
// GAS Tecnologia), um agente NATIVO de atestação do dispositivo — um
// `<object classid="CLSID:E37CB5F0-…">` mais `js/warsaw-lib/*` em
// `/aop/gcs/statics/gas/validacao.bb`. Um navegador em container não passa nisso, e
// derrotar atestação de dispositivo está fora de questão. O endereço ficou no
// catálogo apontando para uma porta que responde 403 — foi corrigido junto com este
// conector.
//
// O CAMINHO QUE EXISTE
//
// O Licitações-e novo (`licitacoes-e2.bb.com.br`) é um Angular sobre uma API REST
// PÚBLICA: sem token, sem cookie, sem sessão. Duas rotas bastam, medidas no próprio
// tráfego do portal (16/09/2026):
//
//   POST /aop-inter-api/api/v1/licitacao/carregar-dados-basicos/{id}
//   POST /aop-inter-api/api/v1/anexosDossie/listar-s3/{id}
//
// E o `{id}` sai DE GRAÇA: o PNCP publica o endereço do processo já com ele dentro —
// `…/aop-inter-estatico/visualizar-processo-publico/1100862`. Medido na base:
// 5.536 de 5.536 contratações de "Licitações-E BB" têm `link_externo`, 100%. Não
// precisa de resolvedor como o PCP; o link já vem na seleção, como no BLL/BNC.
//
// ESTE CONECTOR NÃO LÊ CHAT — E ISSO É PROPOSITAL
//
// Não há mensageria pública no Licitações-e. Verificado inclusive num processo com
// `exibirMensageria: true`: o que abre para quem não é participante é o DOSSIÊ. Então
// é o dossiê que monitoramos, e ele é mais útil do que parece — cada peça chega com
// carimbo de hora:
//
//   IMPUGNACAO_SIEMENS.pdf          09/09/2026 15:57:56
//   PED_ESC_CANON.pdf               09/09/2026 15:57:32
//   EDITAL PE.471.2026.pdf          31/08/2026 14:47:23
//
// Impugnação e pedido de esclarecimento de concorrente são exatamente o tipo de fato
// que muda o que o fornecedor faz hoje. Mais a `situacao` do certame, que é onde
// aparece "Suspensa".
//
// Quem mexer aqui: NÃO chame isto de chat na UI. Prometer mensagem onde só há
// documento é a falsa sensação de segurança que o requisito 4.2 proíbe.

import {
  normalizarMensagem, horarioBrParaISO, ehRecusaDoPortal, withBackoff,
  PortalRecusou, SIMULADO_FIXTURES,
} from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const META = portalMeta('licitacoes-e')
const API = 'https://licitacoes-e2.bb.com.br/aop-inter-api/api/v1'

// Sem navegador, cada processo custa 2 requisições de JSON em vez de ~12 s de
// Chromium. O teto existe mesmo assim: o BB responde 403 para quem passa do ponto
// (medido), e ser barrado custa mais caro do que ler devagar.
const TETO_PROCESSOS = 120
// Respiro entre processos. O BB bloqueia por reputação/volume, então a passada anda
// em ritmo humano de propósito.
const PAUSA_MS = 350
// Teto por requisição. O `fetch` do Node NÃO tem timeout por padrão (o undici só corta
// em ~300 s de headersTimeout), e este é o único conector sem o `page.goto(…, {timeout})`
// do Playwright por trás. Uma conexão que o BB aceita e não responde travaria a passada
// INTEIRA — o run.mjs roda os portais em sequência, então Licitanet, BLL e PCP ficariam
// esperando atrás.
const TIMEOUT_MS = 20000

/**
 * RECUSA É FATO SOBRE O PORTAL, NÃO SOBRE O TENANT.
 *
 * O `run.mjs` chama este `sync` uma vez POR TITULAR. Parar na 1ª recusa dentro do laço
 * protege a passada de UM tenant; com 5 tenants monitorando o portal, um 403 vira 5
 * rodadas novas contra a mesma porta fechada — e, se a regra do WAF for por taxa, é
 * exatamente isso que renova o bloqueio.
 *
 * O flag vive no escopo do módulo. O processo do worker morre ao fim da passada, então
 * ele se limpa sozinho entre rodadas; `esquecerRecusa()` existe para os testes.
 */
let recusadoNestaRodada = null
export function esquecerRecusa() { recusadoNestaRodada = null }

const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Situações que são FATO NOVO para quem disputa — as demais são ciclo de vida normal. */
const SITUACAO_RELEVANTE =
  /suspens|revoga|anulad|cancelad|prorrog|adiad|remarcad|retomad|reabert|deserto|fracassad|impugnad/i

/**
 * O id do BB dentro do endereço que o PNCP publica.
 * Devolve `null` quando a URL não é de um processo do Licitações-e — inclusive para
 * `…/comprador/licitacao`, que aparece na base e é a home do comprador, não processo.
 *
 * O HOST É ANCORADO NO INÍCIO de propósito. Sem a âncora, o `.*` faz qualquer URL que
 * apenas CONTENHA a string casar — `https://outro.example/x?u=licitacoes-e2.bb.com.br/
 * a/visualizar-processo-publico/999` devolvia `999`. Não é SSRF (a base da API é
 * constante), mas o conector pediria ao BB o processo 999 e gravaria os eventos de
 * OUTRO certame sob o `licitacaoId` deste cliente — pior do que não ter mensagem.
 *
 * COBERTURA: os 5.534 endereços do portal NOVO entram todos. Ficam de fora 58 linhas
 * da base que apontam para o portal antigo (`…/consultar-detalhes-licitacao.aop?…&
 * numeroLicitacao=<id>`). O id aparece ali com o mesmo nome que o payload devolve, mas
 * NÃO confirmei que é o mesmo espaço de ids — e casar errado grava evento de outro
 * certame. Fica medido e fora até dar para conferir com o BB respondendo.
 */
export function idDoProcesso(url) {
  const m = String(url ?? '').match(
    /^https?:\/\/licitacoes-e2\.bb\.com\.br\/[^?#]*\/visualizar-processo-publico\/(\d+)/i)
  return m ? m[1] : null
}

/**
 * Como o arquivo do dossiê se apresenta a quem lê o alerta.
 *
 * O `descricaoTipoArquivo` do BB é genérico a ponto de enganar: impugnação e pedido
 * de esclarecimento chegam os dois como "Documento de Oficialização da Demanda"
 * (medido). Quem diz o que a peça é, na prática, é o NOME do arquivo — é assim que os
 * órgãos nomeiam: `IMPUGNACAO_SIEMENS.pdf`, `PED_ESC_CANON.pdf`, `RESP_ESC_*.pdf`.
 * Por isso o rótulo sai do nome, e o tipo do BB vai junto sem mandar na frase.
 *
 * A ORDEM DAS REGRAS É O QUE MAIS IMPORTA AQUI. `RESPOSTA_IMPUGNACAO_X.pdf` é o órgão
 * RESPONDENDO, não um concorrente impugnando — e testar `IMPUGNA` antes de `RESP`
 * invertia o fato. Não é só rótulo torto: `impugna` está em `PADROES['recurso']`
 * (run.mjs) e `recurso` está no conjunto ALTA, ou seja, o fornecedor receberia e-mail
 * de prioridade alta dizendo que impugnaram o edital quando o que houve foi a RESPOSTA
 * de uma impugnação antiga. Por isso as respostas são testadas primeiro.
 */
export function rotuloDoAnexo(nome) {
  const n = String(nome ?? '').toUpperCase()
  // Respostas e decisões primeiro — elas contêm o nome da peça original.
  if (/^RESP|RESPOSTA|JULGAMENTO|DECISAO|DEFERI|INDEFERI/.test(n)) {
    if (/IMPUGNA/.test(n)) return 'Resposta a impugnação'
    if (/RECURSO|CONTRARRAZ/.test(n)) return 'Decisão de recurso'
    return 'Resposta a esclarecimento'
  }
  if (/IMPUGNA/.test(n)) return 'Impugnação'
  if (/PED_ESC|PEDIDO.*ESCLAREC|ESCLARECIMENTO/.test(n)) return 'Pedido de esclarecimento'
  if (/RECURSO|CONTRARRAZ/.test(n)) return 'Recurso'
  if (/RETIFICA|ERRATA|ADENDO/.test(n)) return 'Retificação do edital'
  // ATA precisa de âncora: sem ela casa DENTRO de outras palavras — C-ATA-LOGO, D-ATA,
  // PL-ATA-FORMA. "Ata anexada: CATALOGO_PRODUTOS.pdf" é o tipo de linha que faz o
  // fornecedor parar de confiar na caixa.
  if (/(^|[^A-Z0-9])ATA([^A-Z0-9]|$)/.test(n)) return 'Ata'
  if (/EDITAL/.test(n)) return 'Edital'
  return 'Documento'
}

/**
 * O `fetch` que o conector usa. Injetável porque os três caminhos que sustentam o
 * `disponivel: true` deste portal — recusa, bloqueio com 200, envelope de erro — são
 * sobre a RESPOSTA, e sem poder forjá-la eles só podiam ser afirmados, não testados.
 */
let buscar = (...a) => fetch(...a)
export function usarBuscador(fn) { buscar = fn ?? ((...a) => fetch(...a)) }

/** Uma chamada à API. Lança em recusa do portal, para o laço parar. */
async function pedir(caminho) {
  const url = `${API}/${caminho}`
  const headers = {
    'user-agent': UA_NAVEGADOR,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'pt-BR,pt;q=0.9',
  }
  // POST é o que o próprio portal usa (lido do tráfego dele). O GET fica como rede de
  // segurança para 404/405 e SÓ para isso — não pude confirmar o GET ao vivo, porque
  // o BB estava respondendo 403 a esta máquina quando o conector foi escrito.
  const opcoes = { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }
  let r = await withBackoff(() => buscar(url, { method: 'POST', ...opcoes }), 2)
  if (r.status === 404 || r.status === 405) {
    r = await withBackoff(() => buscar(url, { method: 'GET', ...opcoes }), 2)
  }

  // UM protocolo de recusa, não dois. O commit anterior criou `PortalRecusou` na base e
  // o Licitanet o reconhece por `instanceof`; um campo solto `e.recusa` aqui seria um
  // segundo contrato para o mesmo conceito, criado no mesmo PR.
  if (ehRecusaDoPortal(r.status)) throw new PortalRecusou(r.status, url)

  const texto = await r.text()
  try {
    return JSON.parse(texto)
  } catch {
    // HTML onde devia vir JSON = página de erro/bloqueio servida com 200. Dizer isso
    // é melhor do que devolver "sem novidades" por um corpo que não entendemos.
    const e = new Error(`resposta não é JSON (${r.status}, ${texto.length} bytes)`)
    e.status = r.status
    throw e
  }
}

/**
 * O `data` de dentro do envelope `{status, messages, statusCode, data}` do BB.
 *
 * O ENVELOPE PODE CARREGAR O ERRO DENTRO DE UM HTTP 200: `{status:'ERRO',
 * statusCode:500, data:null}`. Conferir só o status HTTP deixava isso virar `data:null`
 * → `[]` mensagens → processo contado como LIDO → `sync` terminando em `ok` com "0
 * evento(s)". Aí o run.mjs avança `verificado_em` e a tela diz "verificado agora, sem
 * novidades" para uma passada em que o portal não entregou nada.
 *
 * É o requisito 4.2 ao contrário, e é o mesmo pecado que o commit do Licitanet corrigiu
 * — incerteza não pode parecer silêncio. Por isso o envelope ruim LANÇA.
 */
function dados(resposta) {
  if (resposta && typeof resposta === 'object' && 'status' in resposta
      && String(resposta.status).toUpperCase() !== 'OK') {
    const codigo = resposta.statusCode
    // 5xx dentro do envelope é o portal falhando, não este processo: vira recusa para
    // o laço parar em vez de repetir o erro 120 vezes.
    if (Number(codigo) >= 500) throw new PortalRecusou(Number(codigo), API)
    const e = new Error(`envelope de erro do BB (${resposta.status}${codigo ? ` / ${codigo}` : ''})`)
    e.status = codigo ?? null
    throw e
  }
  return resposta && typeof resposta === 'object' && 'data' in resposta ? resposta.data : resposta
}

/**
 * Transforma o que a API devolveu em mensagens do Radar. PURA de propósito: é ela que
 * os testes exercitam com os payloads reais gravados, sem tocar na rede.
 */
export function montarMensagens({ basicos, anexos }) {
  const out = []
  const b = dados(basicos) ?? {}
  const edital = b.codigoEdital ? `edital ${b.codigoEdital}` : null

  // 1) A situação do certame — só quando ela é um fato, não ciclo de vida.
  //    `horarioOrigem` fica nulo porque o BB não diz QUANDO a situação mudou.
  //
  //    LIMITAÇÃO CONHECIDA, e é preciso dizê-la em vez de fingir que não existe: o
  //    dedup do run.mjs é `sha256(conector, licitacao, autor, texto, horarioOrigem)`
  //    com `ON CONFLICT (msg_hash) DO NOTHING`, sem janela de tempo. Então o aviso vale
  //    para a PRIMEIRA vez que cada situação aparece — e uma situação que VOLTA
  //    (Suspensa → Retomada → Suspensa de novo, sem remarcar a disputa) produz texto
  //    idêntico, hash idêntico, e é engolida.
  //
  //    Resolver de verdade exige lembrar a última situação vista por processo, e esse
  //    estado não existe aqui: o conector é sem memória entre passadas e não fala com o
  //    banco. O `codigoSituacao` já vai no `raw` justamente para quando esse estado
  //    existir. Até lá: a 1ª suspensão avisa, a reincidência não.
  if (b.situacao && SITUACAO_RELEVANTE.test(String(b.situacao))) {
    const partes = [`Situação do processo no ${META.nome}: ${b.situacao}`]
    if (edital) partes.push(`(${edital})`)
    if (b.dataHoraDisputa) partes.push(`· disputa marcada para ${b.dataHoraDisputa}`)
    if (b.nomePregoeiro) partes.push(`· pregoeiro(a): ${b.nomePregoeiro}`)
    out.push({
      autor: 'Sistema',
      texto: partes.join(' '),
      horarioOrigem: null,
      raw: { fonte: 'situacao', situacao: b.situacao, codigoSituacao: b.codigoSituacao },
    })
  }

  // 2) O dossiê. Cada peça é um evento com hora — é o que mais se parece com
  //    "mensagem nova" neste portal.
  const lista = dados(anexos)
  for (const a of Array.isArray(lista) ? lista : []) {
    const nome = String(a?.nomeArquivo ?? '').trim()
    if (!nome) continue
    const rotulo = rotuloDoAnexo(nome)
    const tipo = String(a?.descricaoTipoArquivo ?? '').trim()
    // O tipo do BB só entra quando acrescenta algo ao que o nome já disse.
    const sufixo = tipo && tipo.toLowerCase() !== rotulo.toLowerCase() ? ` [${tipo}]` : ''
    out.push({
      autor: 'Dossiê',
      texto: `${rotulo} anexada(o) ao processo: ${nome}${sufixo}`,
      // `timestampInclusaoArquivo` vem "09/09/2026 15:57:56" — formato BR, mesmo de
      // todo portal brasileiro, então o conversor da base dá conta.
      horarioOrigem: horarioBrParaISO(a?.timestampInclusaoArquivo),
      raw: { fonte: 'anexo-dossie', ...a },
    })
  }
  return out
}

export async function sync({ processos = [], simulado }) {
  if (simulado) {
    const mensagens = []
    const alvos = processos.length ? processos : [{ licitacaoId: 'SIMULADO-licitacoes-e' }]
    for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
  }

  const comId = processos
    .map((p) => ({ ...p, bbId: idDoProcesso(p?.urlPublica) }))
    .filter((p) => p.bbId)
  const semId = processos.length - comId.length
  const alvos = comId.slice(0, TETO_PROCESSOS)
  const truncados = comId.length - alvos.length

  if (!alvos.length) {
    return {
      status: 'ok',
      mensagens: [],
      detalhe: `nenhum processo com endereço do ${META.nome} nesta passada${semId ? ` (${semId} sem link /visualizar-processo-publico/)` : ''}`,
    }
  }

  // O portal já fechou a porta nesta rodada, para outro tenant? Então nem abrimos.
  if (recusadoNestaRodada) {
    return {
      status: 'portal_indisponivel',
      mensagens: [],
      detalhe: `o ${META.nome} já recusou a conexão (HTTP ${recusadoNestaRodada}) nesta rodada — não insisti`,
    }
  }

  const mensagens = []
  const falhas = []
  let lidos = 0
  let comNovidade = 0
  let recusa = null

  for (const p of alvos) {
    try {
      // Os dois pedidos do processo. Se o primeiro já for recusa, o segundo nem sai.
      const basicos = await pedir(`licitacao/carregar-dados-basicos/${p.bbId}`)
      const anexos = await pedir(`anexosDossie/listar-s3/${p.bbId}`)
      const linhas = montarMensagens({ basicos, anexos })
      lidos++
      if (linhas.length) comNovidade++
      for (const l of linhas) mensagens.push(normalizarMensagem(l, p.licitacaoId))
    } catch (e) {
      // Mesma regra do Licitanet: recusa é sobre o PORTAL, não sobre este processo.
      // Continuar seria bater 119 vezes contra a mesma porta fechada — e o flag de
      // módulo impede que os outros tenants da mesma rodada repitam a batida.
      if (e instanceof PortalRecusou) { recusa = e; recusadoNestaRodada = e.status; break }
      falhas.push(`${p.licitacaoId}: ${String(e?.message ?? e).slice(0, 80)}`)
    }
    if (PAUSA_MS) await new Promise((r) => setTimeout(r, PAUSA_MS))
  }

  if (recusa) {
    const parcial = lidos ? `${lidos} de ${alvos.length} processo(s) lidos antes` : 'nenhum processo foi lido'
    return {
      status: 'portal_indisponivel',
      mensagens,
      detalhe: `o ${META.nome} recusou a conexão (HTTP ${recusa.status}) — ${parcial}; parei na 1ª recusa para não insistir contra o bloqueio`,
    }
  }

  if (falhas.length === alvos.length) {
    // NEM TODO BLOQUEIO VEM COM 403. Interstitial de Cloudflare e desafio do AWS WAF
    // são servidos com HTTP 200 + HTML — `ehRecusaDoPortal(200)` é falso, cada processo
    // cai aqui com "resposta não é JSON", e sem esta checagem os 120 viravam `falha`.
    // `falha` quer dizer "conserte o código", e mandaria quem lê caçar um parser que
    // está certo: exatamente o diagnóstico errado que o commit do Licitanet elimina.
    //
    // Quando TODAS falham do mesmo jeito, e por algo que não é sobre ESTE processo, o
    // sujeito é o portal.
    const doPortal = falhas.every((f) => /resposta não é JSON|envelope de erro|fetch failed|ECONN|ENOTFOUND|timeout|abort/i.test(f))
    return {
      status: doPortal ? 'portal_indisponivel' : 'falha',
      mensagens: [],
      detalhe: `nenhum dos ${alvos.length} processo(s) do ${META.nome} pôde ser lido — ${falhas[0]}`,
    }
  }

  const partes = [`${mensagens.length} evento(s) em ${comNovidade}/${alvos.length} processo(s)`]
  if (falhas.length) partes.push(`${falhas.length} não lido(s)`)
  if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
  if (semId) partes.push(`${semId} sem endereço do processo`)
  // Dito em toda passada porque é a diferença entre o que entregamos e o que o
  // cliente pode achar que entregamos.
  partes.push('dossiê público (situação + anexos com hora) — este portal não tem chat público')

  return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
}
