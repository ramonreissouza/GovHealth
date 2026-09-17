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

import { montarMensagens, idDoProcesso, rotuloDoAnexo } from './connector-licitacoes-e.mjs'

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

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
