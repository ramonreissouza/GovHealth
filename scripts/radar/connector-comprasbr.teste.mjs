// scripts/radar/connector-comprasbr.teste.mjs — o leitor da API pública do Compras BR.
//
// Três coisas que este arquivo existe para impedir, todas colhidas da API real em
// 15/09/2026:
//
//   1) VAZAR DADO DE TERCEIRO. Cada pedido vem com o objeto `fornecedor` COMPLETO de
//      quem o protocolou — CNPJ, razão social, endereço, telefone, e-mail — e o e-mail
//      em `usuarioCadastro`. É um concorrente do nosso cliente, e nada disso é preciso
//      para avisar que o edital foi questionado. O teste exige que NADA disso sobreviva
//      à leitura, nem no texto nem no `raw` gravado no banco.
//   2) ALARME DE ROTINA. `ABERTO`, `AGUARDANDO_ABERTURA` e `ENCERRADO` foram 40 de 40
//      numa amostra: emiti-los daria uma mensagem por processo já na primeira visita.
//      Só ruptura (suspenso, revogado, anulado…) vira mensagem.
//   3) CONFUNDIR "LEU E NÃO TEM" COM "NÃO DEU PARA LER" (requisito 4.2). O endpoint
//      sempre devolve as duas chaves, mesmo vazias; uma resposta SEM elas não é a que
//      esperamos e não pode ser reportada como leitura.
//
// E um detalhe que parece cosmético e não é: metade dos fornecedores escreve a pergunta
// inteira no `assunto`, com quebra de linha. Esse texto vai para e-mail — quebra crua
// estraga o layout dos dois lados.

import {
  extrairPedidos, mensagemDoPedido, mensagemDeStatus,
  idDaLicitacao, urlDeProcesso, horarioApiParaISO,
} from './connector-comprasbr.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

// Resposta real da API, encurtada — inclusive o `fornecedor` que NÃO pode sair daqui.
const RESPOSTA = {
  esclarecimentos: [
    {
      id: 18146,
      fornecedor: {
        id: 23023, cpfCnpj: '34412925000161', tipoPessoa: 'J',
        razaoSocial: 'ATHENA COMERCIO DE PRODUTOS ODONTOLOGICOS MEDICOS E HOSPITALARES - EIRELI',
        telefone: '1237972240', email: 'licitacao@athenaprodutos.com.br',
      },
      dataCadastro: '2026-08-24T15:22:36.654+0000',
      usuarioCadastro: 'licitacao@athenaprodutos.com.br',
      tipo: 'ESCLARECIMENTO',
      arquivoNome: 'Pedido de Esclarecimento (02) Pref. de Monte Mor 352026.pdf',
      situacao: 'RESPONDIDO',
      assunto: 'Duplicidade dos Itens na Plataforma Eletrônica.',
    },
    {
      id: 18526,
      dataCadastro: '2026-09-15T12:11:58.000+0000',
      tipo: 'ESCLARECIMENTO',
      situacao: 'AGUARDANDO',
      // O caso real: a pergunta inteira no assunto, com quebra de linha.
      assunto: 'Bom dia Prezados!   Quantas casas decimais devemos considerar?\nO sistema está\r\n  recusando.',
      arquivoNome: null,
    },
  ],
  impugnacoes: [
    {
      id: 17645,
      fornecedor: { cpfCnpj: '11111111000199', razaoSocial: 'KCR EQUIPAMENTOS' },
      dataCadastro: '2026-07-23T13:06:52.528+0000',
      usuarioCadastro: 'LICITACAO4@KCREQUIPAMENTOS.COM.BR',
      tipo: 'IMPUGNACAO',
      arquivoNome: 'IMPUG LOTE - PE 016_2026 - MATINHA.pdf',
      situacao: 'AGUARDANDO',
      assunto: 'IMPUG LOTE -  PE 016/2026 - MATINHA',
    },
  ],
}

console.log('\n── o id vem do link que o PNCP publica ──')
afirmar('id do link', idDaLicitacao('https://comprasbr.com.br/pregao-eletronico-detalhe/?idlicitacao=48015'), '48015')
afirmar('outro parâmetro antes', idDaLicitacao('https://comprasbr.com.br/x/?a=1&idlicitacao=47931'), '47931')
afirmar('sem id', idDaLicitacao('https://comprasbr.com.br/'), null)
afirmar('lixo não explode', idDaLicitacao(null), null)
afirmar('reconhece processo', urlDeProcesso('https://comprasbr.com.br/pregao-eletronico-detalhe/?idlicitacao=48015'), true)
// Um processo de outro portal aqui faria o conector pedir à API um id que não é dela.
afirmar('recusa outro portal', urlDeProcesso('https://licitanet.com.br/sessao/12'), false)

console.log('\n── o horário da API vira ISO que o Postgres aceita ──')
afirmar('+0000 vira +00:00', horarioApiParaISO('2026-08-24T15:22:36.654+0000'), '2026-08-24T15:22:36+00:00')
afirmar('vazio → null', horarioApiParaISO(''), null)
afirmar('lixo → null', horarioApiParaISO('ontem'), null)

console.log('\n── ler é diferente de vir vazio ──')
afirmar('sem nenhuma das chaves → null', extrairPedidos({ erro: 'x' }), null)
afirmar('não-objeto → null', extrairPedidos('<html>'), null)
afirmar('as duas chaves vazias → lista vazia (leitura válida)', extrairPedidos({ esclarecimentos: [], impugnacoes: [] }), [])

console.log('\n── os pedidos ──')
const ped = extrairPedidos(RESPOSTA)
afirmar('3 pedidos (esclarecimentos + impugnações)', ped.length, 3)
afirmar('tipos', ped.map((p) => p.tipo), ['ESCLARECIMENTO', 'ESCLARECIMENTO', 'IMPUGNACAO'])
afirmar('quebra de linha no assunto vira uma linha só',
  ped[1].assunto, 'Bom dia Prezados! Quantas casas decimais devemos considerar? O sistema está recusando.')

console.log('\n── DADO DE TERCEIRO NÃO PODE SOBREVIVER ──')
const msgs = ped.map((p) => mensagemDoPedido(p, 'LIC-1'))
const tudo = JSON.stringify(msgs)
afirmar('CNPJ do impugnante não aparece', /34412925000161|11111111000199/.test(tudo), false)
afirmar('razão social não aparece', /ATHENA|KCR EQUIPAMENTOS/.test(tudo), false)
afirmar('e-mail não aparece', /@/.test(tudo), false)
afirmar('telefone não aparece', /1237972240/.test(tudo), false)
// O `raw` é o que vai gravado no banco — é lá que um vazamento ficaria para sempre.
// `normalizarMensagem` embrulha o objeto inteiro que o conector passa, então o payload
// que montamos fica em `.raw.raw`; o que importa é que NENHUM dos dois níveis carregue
// campo da API que não tenhamos escolhido a dedo.
afirmar('o payload gravado só tem o que precisamos',
  Object.keys(msgs[0].raw.raw).sort(), ['arquivo', 'pedidoId', 'situacao', 'tipo'])
afirmar('nenhum campo cru da API sobrevive no raw',
  Object.keys(msgs[0].raw).filter((k) => /fornecedor|usuarioCadastro|cpfCnpj|email|telefone/i.test(k)), [])

console.log('\n── o que a mensagem diz ──')
afirmar('marca o tipo e o protocolo', msgs[0].texto.startsWith('[Esclarecimento nº 18146]'), true)
afirmar('traz o assunto', msgs[0].texto.includes('Duplicidade dos Itens'), true)
// Aqui a situação ENTRA no texto, ao contrário do eGov RS: sem corpo de resposta, a
// mudança de situação é o ÚNICO sinal de que o órgão respondeu.
afirmar('a situação entra no texto', msgs[0].texto.includes('Situação: respondido'), true)
afirmar('cita o anexo', msgs[0].texto.includes('documento anexado: Pedido de Esclarecimento'), true)
afirmar('impugnação é rotulada como tal', msgs[2].autor, 'Impugnação — pedido')
afirmar('horário em ISO', msgs[0].horarioOrigem, '2026-08-24T15:22:36+00:00')
afirmar('pedido sem assunto nem anexo não vira mensagem',
  mensagemDoPedido({ id: 1, tipo: 'ESCLARECIMENTO', assunto: null, arquivo: null, situacao: 'X', quando: null }, 'L'), null)

console.log('\n── status: só ruptura vira mensagem ──')
for (const s of ['ABERTO', 'AGUARDANDO_ABERTURA', 'ENCERRADO']) {
  afirmar(`${s} é rotina, fica calado`, mensagemDeStatus({ status: s, fase: 'LANÇAMENTO DE PROPOSTAS' }, 'L'), null)
}
const sus = mensagemDeStatus({ status: 'SUSPENSO', fase: 'LANÇAMENTO DE PROPOSTAS' }, 'L')
afirmar('SUSPENSO vira mensagem', sus?.texto, 'O processo está SUSPENSO (fase: lançamento de propostas).')
afirmar('REVOGADO vira mensagem', !!mensagemDeStatus({ status: 'REVOGADO' }, 'L'), true)
// O portal não data a mudança de status — inventar um horário aqui faria a mensagem
// passar pela janela de 48 h do e-mail como se fosse novidade de hoje.
afirmar('status não inventa horário', sus?.horarioOrigem, null)
afirmar('status desconhecido fica calado', mensagemDeStatus({ status: 'COISA_NOVA' }, 'L'), null)

console.log(`\n${ok} ok, ${falhou} falhou(ram)\n`)
process.exitCode = falhou ? 1 : 0
