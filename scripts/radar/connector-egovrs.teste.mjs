// scripts/radar/connector-egovrs.teste.mjs — o parser da ata do eGov RS.
//
// O modo de falha deste conector não é explodir: é LER ERRADO E DIZER QUE LEU. Duas
// armadilhas concretas, as duas colhidas da página real (edital 0038/2026 de
// Veranópolis/RS, 15/09/2026), e as duas invisíveis em qualquer teste de "não quebrou":
//
//   1) os ANEXOS se chamam "PEDIDO DE IMPUGNAÇÃO" e "Resposta" — os MESMOS nomes dos
//      marcadores de registro. Um parser que procure esses textos no conteúdo abre um
//      registro fantasma no meio do anterior, e o cliente recebe uma impugnação que
//      nunca existiu;
//   2) ata vazia e página que não é ata parecem iguais para quem só conta registros —
//      e são opostas. "Não foram registrados pedidos" é uma leitura que deu zero, e
//      vale como "sem novidades". Um HTML que mudou de forma NÃO vale, e reportar 'ok'
//      ali viola o requisito 4.2 na pior direção possível: silêncio que parece calmaria.
//
// O fixture abaixo é a estrutura real, encurtada — inclusive os anexos com nome de
// marcador. Se o parser voltar a ancorar em texto em vez de estrutura, este arquivo grita.

import { extrairAta, mensagensDoPedido, idDoEdital, urlDeEdital } from './connector-egovrs.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const DL = 'https://www.compras.rs.gov.br/egov2/download.ctlx?fileType=OFFER_PETITION&id=1&ck=a'

// Estrutura fiel: bgcolor #c6c7c6 = seção, #dddddd = abre pedido, #efefef = protocolo e
// resposta, campos em <b>Rótulo:</b> valor</td>, anexos em <a>.
const ATA = `
<html><body><table>
<tr><td style="text-align: center;"><b>ATA DE ESCLARECIMENTOS E IMPUGNAÇÕES</b></td></tr>
<tr><td><b>EDITAL:</b> 0038/2026 <b>PROCESSO:</b> 270</td></tr>
<tr><td><table>
  <tr><td bgcolor="#c6c7c6"><font size="2"><b>ESCLARECIMENTOS</b></font></td></tr>

  <tr bgcolor="#dddddd"><td><b>Pedido de esclarecimento</b></td></tr>
  <tr bgcolor="#efefef"><td><b>Protocolo 34335</b></td></tr>
  <tr><td><table>
    <tr><td><b>Situação:</b> Respondido</td></tr>
    <tr><td><b>Data do pedido:</b> 10/07/2026 12:38</td></tr>
    <tr><td><b>Solicitação:</b> O objeto inclui Enfermeiro?</td></tr>
    <tr><td><table><tr><td valign="top"><b>Documentos anexados:</b></td>
      <td><table><tr><td><a href="${DL}" title="Abrir documento anexo">ESCLARECIMENTO</a></td></tr></table></td>
    </tr></table></td></tr>
  </table></td></tr>
  <tr bgcolor="#efefef"><td><b>Resposta</b></td></tr>
  <tr><td><b>Data:</b> 10/07/2026 13:34</td></tr>
  <tr><td><b>Responsável:</b> LILIA RECHE CENCI</td></tr>
  <tr><td><b>Texto:</b> Não. Foi desmembrado para o Pregão 039/2026.</td></tr>

  <tr bgcolor="#dddddd"><td><b>Pedido de esclarecimento</b></td></tr>
  <tr bgcolor="#efefef"><td><b>Protocolo 34999</b></td></tr>
  <tr><td><b>Situação:</b> Aguardando resposta</td></tr>
  <tr><td><b>Data do pedido:</b> 12/07/2026 09:05</td></tr>
  <tr><td><b>Solicitação:</b> Qual a carga horária?</td></tr>

  <tr><td bgcolor="#c6c7c6"><font size="2"><b>IMPUGNAÇÕES</b></font></td></tr>

  <tr bgcolor="#dddddd"><td><b>Pedido de impugnação</b></td></tr>
  <tr bgcolor="#efefef"><td><b>Protocolo 34428</b></td></tr>
  <tr><td><b>Situação:</b> Respondido</td></tr>
  <tr><td><b>Data do pedido:</b> 15/07/2026 16:05</td></tr>
  <tr><td><b>Solicitação:</b> Pedido de impugnação</td></tr>
  <tr><td><table><tr><td valign="top"><b>Documentos anexados:</b></td>
    <td><table><tr><td><a href="${DL}">PEDIDO DE IMPUGNAÇÃO</a></td></tr></table></td>
  </tr></table></td></tr>
  <tr bgcolor="#efefef"><td><b>Resposta</b></td></tr>
  <tr><td><b>Data:</b> 21/07/2026 15:53</td></tr>
  <tr><td><b>Julgamento:</b> Negado</td></tr>
  <tr><td><b>Responsável:</b> LILIA RECHE CENCI</td></tr>
  <tr><td><b>Texto:</b> segue resposta em anexo</td></tr>
  <tr><td><table><tr><td valign="top"><b>Documentos anexados:</b></td>
    <td><table><tr><td><a href="${DL}">Resposta</a></td></tr></table></td>
  </tr></table></td></tr>
</table></td></tr>
</table></body></html>`

const VAZIA = `<html><body><table>
<tr><td><b>ATA DE ESCLARECIMENTOS E IMPUGNAÇÕES</b></td></tr>
<tr><td bgcolor="#c6c7c6"><b>ESCLARECIMENTOS</b></td></tr>
<tr><td>Não foram registrados pedidos de esclarecimento.</td></tr>
<tr><td bgcolor="#c6c7c6"><b>IMPUGNAÇÕES</b></td></tr>
<tr><td>Não foram registrados pedidos de impugnação.</td></tr>
</table></body></html>`

console.log('\n── o id do edital vem do link do PNCP ──')
afirmar('banrisul', idDoEdital('https://pregaobanrisul.com.br/editais/0022_2026/355957'), '355957')
afirmar('compras rs', idDoEdital('https://www.compras.rs.gov.br/editais/0452_2026/356155'), '356155')
afirmar('link sem edital', idDoEdital('https://www.compras.rs.gov.br/'), null)
afirmar('lixo não explode', idDoEdital(null), null)
afirmar('reconhece os dois domínios', [
  urlDeEdital('https://pregaobanrisul.com.br/editais/0022_2026/355957'),
  urlDeEdital('https://www.compras.rs.gov.br/editais/0452_2026/356155'),
], [true, true])
// Um processo de OUTRO portal não pode entrar aqui: bateríamos no eGov RS com um id que
// não é dele e leríamos a ata de um edital alheio.
afirmar('recusa outro portal', urlDeEdital('https://licitanet.com.br/sessao/12'), false)

console.log('\n── ata vazia NÃO é ata ilegível ──')
afirmar('sem pedidos → lista vazia (leitura válida)', extrairAta(VAZIA), [])
afirmar('página que não é ata → null', extrairAta('<html><body>Erro 500</body></html>'), null)
afirmar('vazio → null', extrairAta(''), null)

console.log('\n── os registros ──')
const ped = extrairAta(ATA)
// TRÊS, não quatro nem cinco: os anexos "PEDIDO DE IMPUGNAÇÃO" e "Resposta" NÃO abrem
// registro. Este número é o teste inteiro.
afirmar('3 registros (anexo com nome de marcador não abre registro)', ped.length, 3)
afirmar('tipos na ordem', ped.map((p) => p.tipo), ['esclarecimento', 'esclarecimento', 'impugnacao'])
afirmar('protocolos', ped.map((p) => p.protocolo), ['34335', '34999', '34428'])
afirmar('seção segue o cabeçalho', ped.map((p) => p.secao), ['esclarecimentos', 'esclarecimentos', 'impugnacoes'])
afirmar('pedido sem resposta fica sem resposta', ped[1].resposta, null)
afirmar('anexo do pedido', ped[0].anexosPedido.map((a) => a.nome), ['ESCLARECIMENTO'])
afirmar('anexo "Resposta" é anexo, não bloco', ped[2].resposta.anexos.map((a) => a.nome), ['Resposta'])
afirmar('julgamento da impugnação', ped[2].resposta.julgamento, 'Negado')
afirmar('esclarecimento não tem julgamento', ped[0].resposta.julgamento, null)
afirmar('responsável', ped[2].resposta.responsavel, 'LILIA RECHE CENCI')

console.log('\n── pergunta e resposta são mensagens separadas ──')
const m0 = mensagensDoPedido(ped[0], 'LIC-1')
afirmar('duas mensagens quando há resposta', m0.length, 2)
afirmar('horário do pedido em ISO com fuso', m0[0].horarioOrigem, '2026-07-10T12:38:00-03:00')
afirmar('horário da resposta em ISO com fuso', m0[1].horarioOrigem, '2026-07-10T13:34:00-03:00')
// "Situação: Respondido" NÃO pode entrar: existir resposta já prova que foi respondida, e
// um campo que ainda muda dentro de um texto que entra no hash ressuscitaria a mensagem.
afirmar('resposta sem "Situação: Respondido"', /Situação/.test(m0[1].texto), false)
afirmar('resposta traz o texto', m0[1].texto.includes('desmembrado'), true)
afirmar('autor nomeia quem respondeu', m0[1].autor, 'Esclarecimento — resposta de LILIA RECHE CENCI')

const m1 = mensagensDoPedido(ped[1], 'LIC-1')
afirmar('pedido sem resposta → uma mensagem só', m1.length, 1)

const m2 = mensagensDoPedido(ped[2], 'LIC-1')
// O julgamento é a única coisa que o fornecedor precisa ler para saber se o edital mudou.
afirmar('julgamento vem antes do texto', m2[1].texto.indexOf('Negado') < m2[1].texto.indexOf('segue resposta'), true)
// Impugnação cujo conteúdo está SÓ no anexo: sem isto o cliente lê "Pedido de
// impugnação" e conclui que veio vazia.
afirmar('anexo é citado no texto', m2[0].texto.includes('documento anexado: PEDIDO DE IMPUGNAÇÃO'), true)

console.log(`\n${ok} ok, ${falhou} falhou(ram)\n`)
process.exitCode = falhou ? 1 : 0
