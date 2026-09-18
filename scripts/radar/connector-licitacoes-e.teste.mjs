// scripts/radar/connector-licitacoes-e.teste.mjs — a tradução do dossiê do BB.
//
// Os payloads abaixo NÃO são inventados: são a resposta literal do portal para o
// processo 1099465 (pregão 471/2026), capturada em 16/09/2026 do próprio tráfego do
// Licitações-e novo. Ficam aqui porque o BB passou a responder 403 a IP de datacenter
// logo depois, e sem eles o parser volta a ser opinião.
//
// O modo de falha deste conector não é explodir — é traduzir errado e parecer certo:
//
//   1) O `descricaoTipoArquivo` do BB MENTE por generalidade: impugnação e pedido de
//      esclarecimento chegam AMBOS como "Documento de Oficialização da Demanda". Quem
//      rotular a peça pelo tipo entrega "Documento de Oficialização da Demanda" para
//      uma impugnação de concorrente — e o fornecedor não lê, porque não parece nada.
//      O rótulo tem de sair do NOME do arquivo.
//
//   2) A `situacao` chega em TODA passada, sempre igual. Emitir sempre é o certo (o
//      dedup por hash transforma isso num aviso só, e num novo aviso quando muda) —
//      mas só para situação que é FATO. "Publicada" virando mensagem é spam com cara
//      de alerta.
//
//   3) `dataAberturaProposta` vem como string VAZIA, não nula. Qualquer coisa que
//      confie em `?? null` para datas quebra aqui.

import {
  montarMensagens, idDoProcesso, rotuloDoAnexo, sync, usarBuscador, esquecerRecusa,
} from './connector-licitacoes-e.mjs'
import { usarEsperaDeBackoff } from './connector-base.mjs'

// A suite exercita timeout e queda de transporte, e por isso dormia DE VERDADE o
// backoff: 1 s viraram 38 s. Suite de 38 s e suite que as pessoas param de rodar — e
// esta e a prova viva de que o conector nao mente sobre o que leu. O sono vai a zero;
// o que se testa e a LOGICA do retry, nao a duracao do setTimeout.
usarEsperaDeBackoff(() => 0)

/**
 * A SUÍTE NÃO TOCA A REDE — e isto é verificado, não prometido.
 *
 * Uma versão desta suíte fazia 1 chamada real a `licitacoes-e2.bb.com.br`: um
 * `usarBuscador(null)` uma linha cedo demais, e o `sync` seguinte saía pela rede. A
 * asserção passava por ACIDENTE — o portal responde 403, que também não é "já recusou"
 * — em vez de por evidência. Só apareceu porque alguém instrumentou o `fetch` global
 * por fora.
 *
 * Agora o `fetch` global é CONTADO, e a contagem é cobrada no fim da suíte.
 *
 * Contar, e não só lançar: o `sync` embrulha cada processo num `try/catch`, então um
 * `throw` aqui seria engolido como "falha daquele processo" e o teste passaria do mesmo
 * jeito — silenciosamente, que é exatamente o problema. A asserção final é o que
 * transforma o acidente em falha visível.
 */
let tentouRede = []
globalThis.fetch = (url) => {
  tentouRede.push(String(url).slice(0, 80))
  throw new Error('a suíte não pode tocar a rede — forje a resposta com usarBuscador()')
}

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(valor)}`) }
}

// ── payloads reais (processo 1099465, 16/09/2026) ───────────────────────────
const BASICOS = {
  status: 'OK',
  messages: [],
  statusCode: 200,
  data: {
    numeroLicitacao: 1099465,
    codigoEdital: '471/2026',
    modalidade: 'Pregão',
    situacao: 'Suspensa',
    codigoSituacao: 17,
    prazoImpugnacao: 3,
    tipoLicitacao: 'Menor preço',
    equalizacaoICMS: 'SEM ICMS',
    tipoEncerramentoDisputa: '195050202',
    codigoProcesso: '195050202',
    nomePregoeiro: 'FABIOLA PINEIRO CORDEIRO',
    dataHoraDisputa: '16/09/2026 10:00',
    dataPublicacao: '31/08/2026',
    dataInicioAcolhimentoProposta: '14/09/2026 09:00',
    dataFimAcolhimentoProposta: '16/09/2026 10:00',
    dataAberturaProposta: '',
    formaParticipacaoFornecedor: 'Ampla',
    exibirMensageria: false,
  },
}

const ANEXOS = {
  status: 'OK',
  messages: [],
  statusCode: 200,
  data: [
    { nomeArquivo: 'EDITAL PE.471.2026.pdf', timestampInclusaoArquivo: '31/08/2026 14:47:23', codigoTipoArquivo: 2896, descricaoTipoArquivo: 'Edital do Processo de Compra', numeroIdentificacaoDocumento: 260831144723217, codigoTipoRepositorio: 2 },
    { nomeArquivo: 'PED_ESC_CANON.pdf', timestampInclusaoArquivo: '09/09/2026 15:57:32', codigoTipoArquivo: 2904, descricaoTipoArquivo: 'Documento de Oficialização da Demanda', numeroIdentificacaoDocumento: 260909155732166, codigoTipoRepositorio: 2 },
    { nomeArquivo: 'IMPUGNACAO_SIEMENS.pdf', timestampInclusaoArquivo: '09/09/2026 15:57:56', codigoTipoArquivo: 2904, descricaoTipoArquivo: 'Documento de Oficialização da Demanda', numeroIdentificacaoDocumento: 260909155756497, codigoTipoRepositorio: 2 },
  ],
}

// ── 1. o id sai do endereço que o PNCP publica ──────────────────────────────
console.log('\nid do processo (o que o PNCP entrega em link_externo)')
afirmar('processo público',
  idDoProcesso('https://licitacoes-e2.bb.com.br/aop-inter-estatico/visualizar-processo-publico/1100862'),
  '1100862')
// Este aparece na base e NÃO é processo: é a home do comprador. Aceitá-lo faria o
// conector pedir dados de uma licitação inexistente em toda passada.
afirmar('home do comprador não é processo',
  idDoProcesso('https://licitacoes-e2.bb.com.br/aop-inter-estatico/comprador/licitacao'),
  null)
afirmar('portal antigo não vale', idDoProcesso('https://www.licitacoes-e.com.br/aop/index-login.aop'), null)
afirmar('outro portal não vale', idDoProcesso('https://licitanet.com.br/sessao/200135'), null)
afirmar('vazio', idDoProcesso(null), null)

// ── 2. o rótulo sai do NOME, não do tipo genérico do BB ─────────────────────
console.log('\nrótulo do anexo')
afirmar('impugnação', rotuloDoAnexo('IMPUGNACAO_SIEMENS.pdf'), 'Impugnação')
afirmar('pedido de esclarecimento', rotuloDoAnexo('PED_ESC_CANON.pdf'), 'Pedido de esclarecimento')
afirmar('resposta', rotuloDoAnexo('RESP_ESC_GE.pdf'), 'Resposta a esclarecimento')
afirmar('edital', rotuloDoAnexo('EDITAL PE.471.2026.pdf'), 'Edital')
afirmar('desconhecido não inventa', rotuloDoAnexo('anexo_01.pdf'), 'Documento')

// ── 3. a tradução completa ──────────────────────────────────────────────────
console.log('\nmontarMensagens com o payload real')
const msgs = montarMensagens({ basicos: BASICOS, anexos: ANEXOS })
afirmar('1 situação + 3 anexos', msgs.length, 4)

const situacao = msgs[0]
afirmar('a situação vem primeiro', situacao.autor, 'Sistema')
afirmar('a situação diz o que houve, o edital e a disputa',
  situacao.texto,
  'Situação do processo no Licitações-e (Banco do Brasil): Suspensa (edital 471/2026) · disputa marcada para 16/09/2026 10:00 · pregoeiro(a): FABIOLA PINEIRO CORDEIRO')
// Sem hora porque o BB não diz QUANDO mudou. Inventar `new Date()` aqui faria o hash
// mudar a cada passada e o mesmo aviso chegaria de 20 em 20 minutos, para sempre.
afirmar('situação não inventa horário', situacao.horarioOrigem, null)

// A armadilha nº 1, nomeada: as duas peças abaixo têm o MESMO descricaoTipoArquivo.
const impug = msgs.find((m) => /IMPUGNACAO_SIEMENS/.test(m.texto))
const pedido = msgs.find((m) => /PED_ESC_CANON/.test(m.texto))
afirmar('impugnação é chamada de impugnação',
  impug.texto,
  'Impugnação anexada(o) ao processo: IMPUGNACAO_SIEMENS.pdf [Documento de Oficialização da Demanda]')
afirmar('pedido de esclarecimento não vira "Documento de Oficialização"',
  pedido.texto,
  'Pedido de esclarecimento anexada(o) ao processo: PED_ESC_CANON.pdf [Documento de Oficialização da Demanda]')
afirmar('hora do anexo em ISO com o fuso de Brasília', impug.horarioOrigem, '2026-09-09T15:57:56-03:00')

// ── 4. situação rotineira NÃO vira mensagem ─────────────────────────────────
console.log('\nsituação rotineira é silêncio')
const publicada = montarMensagens({
  basicos: { data: { ...BASICOS.data, situacao: 'Publicada' } },
  anexos: { data: [] },
})
afirmar('"Publicada" não gera aviso', publicada.length, 0)
const revogada = montarMensagens({ basicos: { data: { ...BASICOS.data, situacao: 'Revogada' } }, anexos: { data: [] } })
afirmar('"Revogada" gera aviso', revogada.length, 1)

// ── 5. respostas degeneradas não podem virar "sem novidades" silencioso ─────
console.log('\nrespostas degeneradas')
afirmar('sem anexos, só a situação', montarMensagens({ basicos: BASICOS, anexos: { data: [] } }).length, 1)
afirmar('anexos nulo não explode', montarMensagens({ basicos: BASICOS, anexos: null }).length, 1)
afirmar('tudo vazio dá zero', montarMensagens({ basicos: {}, anexos: {} }).length, 0)
afirmar('anexo sem nome é ignorado',
  montarMensagens({ basicos: {}, anexos: { data: [{ nomeArquivo: '   ', timestampInclusaoArquivo: '01/01/2026 10:00:00' }] } }).length,
  0)

// ── 6. rótulos compostos: a ordem das regras inverte o fato ──────────────
//
// `impugna` está em PADROES['recurso'] (run.mjs) e `recurso` está no conjunto ALTA:
// rotular a RESPOSTA do órgão como "Impugnação" manda e-mail de prioridade alta sobre
// um fato que não aconteceu. As asserções antigas só exercitavam nomes simples.
console.log('\nrótulos compostos')
afirmar('RESPOSTA_IMPUGNACAO não vira impugnação', rotuloDoAnexo('RESPOSTA_IMPUGNACAO_SIEMENS.pdf'), 'Resposta a impugnação')
afirmar('RESP_IMPUGNACAO idem', rotuloDoAnexo('RESP_IMPUGNACAO.pdf'), 'Resposta a impugnação')
afirmar('JULGAMENTO_IMPUGNACAO idem', rotuloDoAnexo('JULGAMENTO_IMPUGNACAO.pdf'), 'Resposta a impugnação')
afirmar('RESPOSTA_RECURSO é decisão, não esclarecimento', rotuloDoAnexo('RESPOSTA_RECURSO.pdf'), 'Decisão de recurso')
afirmar('impugnação de verdade continua impugnação', rotuloDoAnexo('IMPUGNACAO_SIEMENS.pdf'), 'Impugnação')
// /ATA/ sem âncora casava dentro de outras palavras — e catálogo de produtos é peça
// corriqueira em pregão de saúde.
afirmar('CATALOGO_PRODUTOS não é ata', rotuloDoAnexo('CATALOGO_PRODUTOS.pdf'), 'Documento')
afirmar('DATA_BASE não é ata', rotuloDoAnexo('DATA_BASE.pdf'), 'Documento')
afirmar('PLATAFORMA não é ata', rotuloDoAnexo('PLATAFORMA.pdf'), 'Documento')
afirmar('ATA_SESSAO continua ata', rotuloDoAnexo('ATA_SESSAO.pdf'), 'Ata')
afirmar('ATA DE REGISTRO continua ata', rotuloDoAnexo('ATA DE REGISTRO.pdf'), 'Ata')

// ── 7. o host precisa estar ancorado ─────────────────────────────
console.log('\nhost ancorado')
// Sem âncora isto devolvia '999': o conector pediria ao BB OUTRO certame e gravaria
// os eventos dele sob o licitacaoId deste cliente.
afirmar('host embutido em querystring não casa',
  idDoProcesso('https://outro.example/x?u=licitacoes-e2.bb.com.br/a/visualizar-processo-publico/999'), null)
afirmar('subdomínio parecido não casa',
  idDoProcesso('https://licitacoes-e2.bb.com.br.evil.test/aop/visualizar-processo-publico/999'), null)
afirmar('o endereço de verdade continua casando',
  idDoProcesso('https://licitacoes-e2.bb.com.br/aop-inter-estatico/visualizar-processo-publico/1100862'), '1100862')

// ── 8. o `sync` — os três caminhos que sustentam o `disponivel: true` ─────
//
// O PR argumentava: "depois do commit 1 o conector não consegue mais mentir. Método
// errado → 'resposta não é JSON'. BB bloqueando → portal_indisponivel. Em nenhum
// caminho ele diz 'sem novidades'." As três afirmações são sobre `pedir()`/`sync()`, e
// nenhuma era exercitada — `montarMensagens` é pura e não vê status HTTP nem envelope.
// Duas delas não se sustentavam. Agora são fato verificável, não argumento.
console.log('\nsync — o que o conector diz quando o portal NÃO entrega')

const PROC = [{ licitacaoId: 'X-1/2026', urlPublica: 'https://licitacoes-e2.bb.com.br/aop-inter-estatico/visualizar-processo-publico/1099465' }]
const resposta = (status, corpo = '{}') => ({ status, text: async () => corpo })

async function syncCom(responder) {
  esquecerRecusa()   // o flag de rodada é de módulo: sem isto um teste herda o anterior
  usarBuscador(async () => responder())
  try { return await sync({ processos: PROC, simulado: false }) }
  finally { usarBuscador(null); esquecerRecusa() }
}

const r403 = await syncCom(() => resposta(403, '<html>403 Forbidden</html>'))
afirmar('403 → portal_indisponivel', r403.status, 'portal_indisponivel')
afirmar('403 → o detalhe diz o que houve', /recusou a conex/.test(r403.detalhe), true)

// O bloqueio que NÃO usa 403: interstitial de WAF servido com 200 + HTML.
const rHtml = await syncCom(() => resposta(200, '<html><body>Access Denied</body></html>'))
afirmar('bloqueio com 200 → não diz ok', rHtml.status !== 'ok', true)
afirmar('bloqueio com 200 → nem diz falha (o código está certo)', rHtml.status, 'portal_indisponivel')

// O envelope de erro do BB DENTRO de um HTTP 200 — o falso "sem novidades".
const rEnv = await syncCom(() => resposta(200, '{"status":"ERRO","statusCode":500,"messages":["x"],"data":null}'))
afirmar('envelope de erro → não diz ok', rEnv.status !== 'ok', true)

// E o contraste, que é o que impede a correção de virar paranoia: entrega de verdade
// CONTINUA dizendo ok.
const rOk = await syncCom(() => resposta(200, JSON.stringify(BASICOS)))
afirmar('payload bom → ok', rOk.status, 'ok')

// A recusa é fato sobre o PORTAL: o 2º tenant da mesma rodada não bate de novo.
esquecerRecusa()
usarBuscador(async () => resposta(403, 'x'))
const t1 = await sync({ processos: PROC, simulado: false })
let bateu = 0
usarBuscador(async () => { bateu++; return resposta(200, JSON.stringify(BASICOS)) })
const t2 = await sync({ processos: PROC, simulado: false })
usarBuscador(null); esquecerRecusa()
afirmar('1º tenant → portal_indisponivel', t1.status, 'portal_indisponivel')
afirmar('2º tenant → não repete a batida', bateu, 0)
afirmar('2º tenant → diz que já recusou', /já recusou/.test(t2.detalhe), true)

// ── 9. o que a 2ª revisão achou dentro das próprias correções ─────────
console.log('\ncorreções da 2ª revisão')

// `^RESP` sem separador engolia palavra que só COMEÇA por RESP — e "termo de
// responsável técnico" é peça comum de habilitação em pregão de saúde.
afirmar('RESPONSAVEL_TECNICO não é resposta', rotuloDoAnexo('RESPONSAVEL_TECNICO.pdf'), 'Documento')
afirmar('RESP_ESC continua resposta', rotuloDoAnexo('RESP_ESC_GE.pdf'), 'Resposta a esclarecimento')
afirmar('RESP_IMPUGNACAO continua resposta', rotuloDoAnexo('RESP_IMPUGNACAO.pdf'), 'Resposta a impugnação')

// O 5xx DENTRO do envelope não é recusa de conexão: o portal respondeu 200 com JSON
// bem formado dizendo que deu erro NAQUELE recurso. Tratar como recusa fazia UMA
// contratação malformada derrubar a passada de todos os tenants da rodada.
{
  esquecerRecusa()
  let chamadas = 0
  const doisProcessos = [PROC[0], { licitacaoId: 'X-2/2026', urlPublica: PROC[0].urlPublica }]
  usarBuscador(async () => {
    chamadas++
    // só o 1º pedido do 1º processo devolve envelope 5xx; o resto vem bom
    return chamadas === 1
      ? resposta(200, '{"status":"ERRO","statusCode":500,"data":null}')
      : resposta(200, JSON.stringify(BASICOS))
  })
  const r = await sync({ processos: doisProcessos, simulado: false })
  afirmar('envelope 5xx isolado não derruba a passada', r.status, 'ok')
  afirmar('o processo seguinte foi lido', r.detalhe.includes('em 1/2 processo'), true)
  // O `usarBuscador(null)` ficava AQUI, uma linha cedo demais: o `sync` abaixo saía
  // pela rede de verdade, batendo no portal do BB. A asserção passava por acidente —
  // o portal responde 403, o que também não é "já recusou" — em vez de por evidência.
  const seguinte = await sync({ processos: PROC, simulado: false })
  afirmar('o próximo tenant não herda bloqueio', /já recusou|já estava/.test(seguinte.detalhe ?? ''), false)
  usarBuscador(null); esquecerRecusa()
}

// Mas envelope de erro em TODOS → aí é o portal, por corroboração.
{
  const r = await syncCom(() => resposta(200, '{"status":"ERRO","statusCode":500,"data":null}'))
  afirmar('envelope de erro em todos → portal_indisponivel', r.status, 'portal_indisponivel')
}

// O sinal de timeout nasce POR TENTATIVA. Com um sinal só, a 2ª tentativa recebia um
// sinal já abortado e o retry virava no-op exatamente no caso do timeout.
{
  esquecerRecusa()
  const sinais = []
  let n = 0
  usarBuscador(async (_url, opcoes) => {
    sinais.push(opcoes.signal)
    if (++n === 1) throw new Error('fetch failed')   // força o withBackoff a tentar de novo
    return resposta(200, JSON.stringify(BASICOS))
  })
  await sync({ processos: PROC, simulado: false })
  usarBuscador(null); esquecerRecusa()
  afirmar('houve 2 tentativas', sinais.length >= 2, true)
  afirmar('cada tentativa tem o SEU sinal', sinais[0] !== sinais[1], true)
  afirmar('o sinal da 2ª não nasce abortado', sinais[1].aborted, false)
}

// Falha de transporte seguida para o laço: sem isso são até 52 min por tenant, com
// todo o resto do Radar esperando atrás (o run.mjs roda os portais em sequência).
{
  esquecerRecusa()
  let tentativas = 0
  const muitos = Array.from({ length: 40 }, (_, i) => ({ licitacaoId: `X-${i}/2026`, urlPublica: PROC[0].urlPublica }))
  usarBuscador(async () => { tentativas++; throw new Error('fetch failed') })
  const r = await sync({ processos: muitos, simulado: false })
  usarBuscador(null); esquecerRecusa()
  // 5 processos × 2 tentativas do withBackoff = 10; sem o teto seriam 80.
  afirmar('para na 5ª falha de transporte seguida', tentativas <= 12, true)
  afirmar('e conclui que é o portal', r.status, 'portal_indisponivel')
}

// A cobrança: nenhuma tentativa de rede em toda a suíte.
console.log('\nhigiene da suíte')
afirmar('a suíte não tocou a rede', tentouRede, [])

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
