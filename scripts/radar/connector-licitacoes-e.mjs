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

import { normalizarMensagem, horarioBrParaISO, ehRecusaDoPortal, SIMULADO_FIXTURES } from './connector-base.mjs'
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

const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Situações que são FATO NOVO para quem disputa — as demais são ciclo de vida normal. */
const SITUACAO_RELEVANTE =
  /suspens|revoga|anulad|cancelad|prorrog|adiad|remarcad|retomad|reabert|deserto|fracassad|impugnad/i

/**
 * O id do BB dentro do endereço que o PNCP publica.
 * Devolve `null` quando a URL não é de um processo do Licitações-e — inclusive para
 * `…/comprador/licitacao`, que aparece na base e é a home do comprador, não processo.
 */
export function idDoProcesso(url) {
  const m = String(url ?? '').match(/licitacoes-e2\.bb\.com\.br\/.*\/visualizar-processo-publico\/(\d+)/i)
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
 */
export function rotuloDoAnexo(nome) {
  const n = String(nome ?? '').toUpperCase()
  if (/IMPUGNA/.test(n)) return 'Impugnação'
  if (/^RESP|RESPOSTA|RESP_ESC/.test(n)) return 'Resposta a esclarecimento'
  if (/PED_ESC|PEDIDO.*ESCLAREC|ESCLARECIMENTO/.test(n)) return 'Pedido de esclarecimento'
  if (/RECURSO|CONTRARRAZ/.test(n)) return 'Recurso'
  if (/RETIFICA|ERRATA|ADENDO/.test(n)) return 'Retificação do edital'
  if (/ATA/.test(n)) return 'Ata'
  if (/EDITAL/.test(n)) return 'Edital'
  return 'Documento'
}

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
  let r = await fetch(url, { method: 'POST', headers })
  if (r.status === 404 || r.status === 405) r = await fetch(url, { method: 'GET', headers })

  if (ehRecusaDoPortal(r.status)) {
    const e = new Error(`HTTP ${r.status}`)
    e.status = r.status
    e.recusa = true
    throw e
  }
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

/** O `data` de dentro do envelope `{status, messages, statusCode, data}` do BB. */
function dados(resposta) {
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
  //    `horarioOrigem` fica nulo porque o BB não diz QUANDO a situação mudou. O
  //    dedup é por hash do texto, então isto vira UM aviso por situação nova e
  //    silêncio enquanto ela não mudar.
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
      // Continuar seria bater 119 vezes contra a mesma porta fechada.
      if (e?.recusa) { recusa = e; break }
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
    return {
      status: 'falha',
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
