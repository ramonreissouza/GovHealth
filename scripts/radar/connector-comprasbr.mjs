// scripts/radar/connector-comprasbr.mjs — conector do COMPRAS BR (MODO PÚBLICO, sem login).
//
// O Compras BR (AZ Tecnologia em Gestão) tem uma API REST PÚBLICA, sem token e sem
// cookie, sob `app.comprasbr.com.br/licitacao-readonly/api/`. Medido em 15/09/2026:
// 25 de 25 processos responderam 200, e 36% deles tinham esclarecimento ou impugnação
// registrada — o melhor aproveitamento de todos os portais ligados até aqui (o eGov RS,
// o segundo, dá 16%).
//
// COMO ISSO FOI ACHADO, porque o caminho importa. A página `comprasbr.com.br/
// pregao-eletronico-detalhe/?idlicitacao=<id>` — que é o link que o PNCP publica — não
// serve para ler nada: ela redireciona para a home e o conteúdo real mora num IFRAME
// apontando para `app.comprasbr.com.br/licitacao-pub/`. Dentro dele, um Angular consome
// a API acima. Então o conector pula a página inteira e fala com a API: sem navegador,
// sem esperar SPA montar, ~1 s por processo em vez dos ~12 s dos conectores com
// Playwright. Daí o teto de 300 processos por passada.
//
// O `idlicitacao` do link do PNCP é o MESMO id da API. Nada a resolver.
//
// ── O QUE ENTRA, E O QUE O PORTAL NÃO DÁ ────────────────────────────────────────────
// Entram duas coisas:
//
//   1. ESCLARECIMENTOS E IMPUGNAÇÕES — com o ASSUNTO escrito pelo próprio fornecedor
//      ("Divergência entre Termo De Referência e Plataforma", "Duplicidade dos Itens na
//      Plataforma Eletrônica"), o tipo, a situação e o nome do arquivo anexado.
//   2. STATUS DO PROCESSO, mas só quando é NOTÍCIA (ver `STATUS_NOTAVEL`).
//
// O que o portal NÃO dá é o corpo da pergunta nem o da resposta: os dois vivem dentro de
// PDFs, e o único campo textual é o `assunto`. Isso é uma diferença real para o eGov RS,
// que entrega a resposta inteira — e está dita no `detalhe` de toda passada, para
// ninguém ler "sem novidades" achando que leu o mérito.
//
// ── POR QUE A SITUAÇÃO ENTRA NO TEXTO AQUI, AO CONTRÁRIO DO eGov RS ─────────────────
// No eGov RS a `Situação` fica FORA do texto, porque lá existe o texto da resposta: a
// resposta chegando já prova que foi respondida, e pôr a situação junto só faria a
// mensagem inteira voltar quando ela mudasse.
//
// Aqui é o oposto, e pelo mesmo raciocínio. Como não há corpo de resposta, a MUDANÇA DE
// SITUAÇÃO é o único sinal de que o órgão respondeu. Com ela no texto, o hash muda de
// AGUARDANDO para RESPONDIDO e o fornecedor recebe exatamente um aviso: "aquilo que
// perguntaram foi respondido, vá ler o anexo". Sem ela, esse fato nunca chegaria.
//
// ── O QUE ESTE CONECTOR SE RECUSA A GRAVAR ──────────────────────────────────────────
// A resposta da API traz, em cada pedido, o objeto `fornecedor` COMPLETO de quem o
// protocolou — CNPJ, razão social, endereço, telefone e e-mail — além do e-mail em
// `usuarioCadastro`. É dado de um TERCEIRO (um concorrente do nosso cliente), e nada
// disso é necessário para avisar que o edital foi questionado. Os dois campos são
// descartados na leitura e nunca chegam ao `raw` gravado no banco. O valor está no
// assunto, não em quem assina.

import { SIMULADO_FIXTURES, normalizarMensagem, withBackoff } from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const META = portalMeta('comprasbr')
const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

const API = 'https://app.comprasbr.com.br/licitacao-readonly/api'
const TETO_PROCESSOS = 300
const PAUSA_MS = 400
const TIMEOUT_MS = 25000

/**
 * Status que MERECEM virar mensagem.
 *
 * A lista é de inclusão, não de exclusão, e isso é deliberado. Os status de rotina
 * (ABERTO, AGUARDANDO_ABERTURA, ENCERRADO — 40 de 40 numa amostra) descrevem o curso
 * normal do pregão; emiti-los geraria uma mensagem por processo já na primeira visita,
 * afogando o que importa. O que entra é ruptura: o que faz o fornecedor mudar de plano.
 * Status novo que o portal invente fica de fora até alguém decidir que é notícia — o
 * erro seguro aqui é o silêncio sobre rotina, não o alarme sobre tudo.
 */
const STATUS_NOTAVEL = new Set([
  'SUSPENSO', 'REVOGADO', 'CANCELADO', 'ANULADO', 'FRACASSADO', 'DESERTO', 'REABERTO',
])

const ROTULO = { ESCLARECIMENTO: 'Esclarecimento', IMPUGNACAO: 'Impugnação' }

/** O id do link que o PNCP publica (`...?idlicitacao=48015`). */
export function idDaLicitacao(url) {
  const m = String(url ?? '').match(/[?&]idlicitacao=(\d+)/i)
  return m ? m[1] : null
}

/** A URL é de um processo do Compras BR? */
export function urlDeProcesso(url) {
  return /comprasbr\.com\.br/i.test(String(url ?? '')) && idDaLicitacao(url) !== null
}

/** "2026-08-24T15:22:36.654+0000" → ISO que o Postgres aceita (+00:00). */
export function horarioApiParaISO(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const m = t.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/)
  if (m) return `${m[1]}${m[2]}${m[3]}:${m[4]}`
  return Number.isNaN(Date.parse(t)) ? null : new Date(t).toISOString()
}

async function pegarJson(url) {
  const res = await withBackoff(
    () => fetch(url, {
      headers: { 'user-agent': UA_NAVEGADOR, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
    2,
  )
  if (!res.ok) return { erro: `HTTP ${res.status}` }
  const txt = await res.text()
  try { return { json: JSON.parse(txt) } } catch { return { erro: 'a resposta não é JSON (o portal mudou?)' } }
}

/**
 * Normaliza um pedido, DESCARTANDO os dados do terceiro que o protocolou.
 * Ver o cabeçalho: `fornecedor` e `usuarioCadastro` não entram, nem aqui nem no `raw`.
 */
function normalizarPedido(p) {
  return {
    id: p?.id ?? null,
    tipo: String(p?.tipo ?? '').toUpperCase(),
    situacao: p?.situacao ?? null,
    // `assunto` é campo livre, e boa parte dos fornecedores escreve a PERGUNTA INTEIRA
    // ali, com quebras de linha ("Bom dia Prezados! Quantas casas decimais…\nO sistema
    // está…"). Isso é bom — é o teor que o PDF esconderia —, mas precisa virar uma linha
    // só: o texto vai para e-mail e para a caixa do Radar, e quebra crua no meio da
    // mensagem quebra o layout dos dois.
    assunto: typeof p?.assunto === 'string' ? p.assunto.replace(/\s+/g, ' ').trim() || null : null,
    arquivo: typeof p?.arquivoNome === 'string' ? p.arquivoNome.replace(/\s+/g, ' ').trim() || null : null,
    quando: horarioApiParaISO(p?.dataCadastro),
  }
}

/**
 * Lê os esclarecimentos/impugnações de um processo.
 * `null` = não deu para ler (formato inesperado). `[]` = leu e não há nenhum — que é
 * uma leitura válida e vale como "sem novidades" (requisito 4.2).
 */
export function extrairPedidos(json) {
  if (!json || typeof json !== 'object') return null
  const e = json.esclarecimentos
  const i = json.impugnacoes
  // O endpoint SEMPRE devolve as duas chaves, mesmo vazias. Não ter nenhuma das duas
  // significa que a resposta não é a que esperamos — e aí não se pode dizer "leu".
  if (!Array.isArray(e) && !Array.isArray(i)) return null
  return [...(Array.isArray(e) ? e : []), ...(Array.isArray(i) ? i : [])].map(normalizarPedido)
}

/** Um pedido vira uma mensagem. */
export function mensagemDoPedido(p, licitacaoId) {
  if (!p.assunto && !p.arquivo) return null
  const rotulo = ROTULO[p.tipo] ?? 'Pedido'
  const marca = `[${rotulo}${p.id ? ` nº ${p.id}` : ''}]`
  const situacao = p.situacao ? String(p.situacao).replace(/_/g, ' ').toLowerCase() : null
  const corpo = [
    p.assunto,
    situacao ? `Situação: ${situacao}` : null,
    p.arquivo ? `(documento anexado: ${p.arquivo})` : null,
  ].filter(Boolean).join(' — ')

  return normalizarMensagem({
    autor: `${rotulo} — pedido`,
    texto: `${marca} — ${corpo}`,
    horarioOrigem: p.quando,
    anexos: p.arquivo ? [p.arquivo] : [],
    raw: { tipo: p.tipo, pedidoId: p.id, situacao: p.situacao, arquivo: p.arquivo },
  }, licitacaoId)
}

/** O status do processo vira mensagem só quando é ruptura. */
export function mensagemDeStatus(detalhe, licitacaoId) {
  const status = String(detalhe?.status ?? '').toUpperCase()
  if (!STATUS_NOTAVEL.has(status)) return null
  const fase = detalhe?.fase ? ` (fase: ${String(detalhe.fase).toLowerCase()})` : ''
  return normalizarMensagem({
    autor: 'Situação do processo',
    texto: `O processo está ${status.replace(/_/g, ' ')}${fase}.`,
    horarioOrigem: null, // o portal não datas a mudança de status; sem inventar.
    anexos: [],
    raw: { status, fase: detalhe?.fase ?? null },
  }, licitacaoId)
}

async function lerProcesso(id, licitacaoId) {
  const a = await pegarJson(`${API}/public/v1/licitacoes/${encodeURIComponent(id)}/esclarecimentosImpugnacoes`)
  if (a.erro) return { erro: a.erro }
  const pedidos = extrairPedidos(a.json)
  if (pedidos === null) return { erro: 'a resposta não tem esclarecimentos/impugnações (o portal mudou?)' }

  const mensagens = []
  for (const p of pedidos) {
    const m = mensagemDoPedido(p, licitacaoId)
    if (m) mensagens.push(m)
  }

  // O status é um SEGUNDO pedido. Se ele falhar, NÃO invalida o que já foi lido — mas
  // também não se finge que o status foi conferido: a passada conta essa falha à parte.
  let statusFalhou = false
  const b = await pegarJson(`${API}/licitacao/public/portal/paginaInterna/idLicitacao=${encodeURIComponent(id)}`)
  if (b.erro) statusFalhou = true
  else {
    const m = mensagemDeStatus(b.json, licitacaoId)
    if (m) mensagens.push(m)
  }
  return { mensagens, temPedido: pedidos.length > 0, statusFalhou }
}

export async function sync({ credencial, processos = [], simulado }) {
  if (simulado) {
    const mensagens = []
    const alvos = processos.length ? processos : [{ licitacaoId: 'SIMULADO-comprasbr' }]
    for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
  }

  const todos = processos.filter((p) => urlDeProcesso(p?.urlPublica))
  const semUrl = processos.length - todos.length
  const alvos = todos.slice(0, TETO_PROCESSOS)
  const truncados = todos.length - alvos.length

  if (!alvos.length) {
    return {
      status: 'ok',
      mensagens: [],
      detalhe: `nenhum processo do ${META.nome} nesta passada${semUrl ? ` (${semUrl} sem idlicitacao no link)` : ''}`,
    }
  }

  const mensagens = []
  const falhas = []
  let comConteudo = 0
  let statusNaoLido = 0
  let redeMorta = 0

  for (const p of alvos) {
    const id = idDaLicitacao(p.urlPublica)
    try {
      const r = await lerProcesso(id, p.licitacaoId)
      if (r.erro) { falhas.push(`${p.licitacaoId}: ${r.erro}`); continue }
      if (r.temPedido) comConteudo++
      if (r.statusFalhou) statusNaoLido++
      mensagens.push(...r.mensagens)
    } catch (e) {
      const msg = String(e?.message ?? e)
      if (/timeout|abort|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(msg)) redeMorta++
      falhas.push(`${p.licitacaoId}: ${msg.slice(0, 80)}`)
    }
    await new Promise((r) => setTimeout(r, PAUSA_MS))
  }

  if (falhas.length === alvos.length) {
    if (redeMorta === alvos.length) {
      return { status: 'portal_indisponivel', mensagens: [], detalhe: `${META.nome} não respondeu em nenhuma das ${alvos.length} tentativa(s)` }
    }
    return { status: 'falha', mensagens: [], detalhe: `nenhum dos ${alvos.length} processo(s) do ${META.nome} pôde ser lido — ${falhas[0]}` }
  }

  const partes = [`${mensagens.length} mensagem(ns) em ${comConteudo}/${alvos.length} processo(s)`]
  if (falhas.length) partes.push(`${falhas.length} não lido(s)`)
  if (statusNaoLido) partes.push(`${statusNaoLido} sem conferir a situação`)
  if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
  // Dito em toda passada de propósito: o mérito está no PDF, e quem lê o alerta precisa
  // saber que o assunto não é a resposta.
  partes.push('assunto e situação do pedido (o teor fica no documento anexado)')

  return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
}
