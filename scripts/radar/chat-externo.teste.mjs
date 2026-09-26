import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatSoNoPortal, portalSoVisualizacao, situacaoLeitura } from '../../src/lib/radar/chat-externo.mjs'

const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra'
const oficial = `${base}?compra=94300105002432026`
const semLeitura = [{ conectorId: 'comprasgov', status: 'nao_monitorado' }, { conectorId: 'bnc', status: 'ok' }]
const lendo = [{ conectorId: 'comprasgov', status: 'ok' }]
// O que a tela passa: CONECTORES disponíveis, sem o comprasgov.
const LEITORES = ['pcp', 'bll', 'bnc', 'licitanet', 'ammlicita', 'egovrs', 'banrisul', 'comprasbr']

// Pregão da seleção automática: licitacao_id é o nº do PNCP.
const auto = (extra) => ({ conectorId: 'comprasgov', portal: 'comprasgov', licitacaoId: '07954480000179-1-022924/2026', linkPortal: null, ...extra })

test('pregão de portal com leitor: lido, sem quadro nem aviso', () => {
  const bnc = { conectorId: 'bnc', portal: 'bnc', licitacaoId: 'x', linkOrigem: 'https://bnc.org.br/sessao/1', linkPortal: null }
  assert.equal(situacaoLeitura(bnc, semLeitura, LEITORES), 'lido')
  assert.equal(chatSoNoPortal(bnc, semLeitura, LEITORES), null)
})

test('Compras.gov.br com o link público do PNCP vira quadro no endereço oficial', () => {
  assert.equal(situacaoLeitura(auto({ linkOrigem: oficial }), semLeitura, LEITORES), 'so_no_portal')
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: oficial }), semLeitura, LEITORES), { link: oficial })
})

test('link de "landing" do PNCP também abre o chat oficial (524 pregões vinham assim)', () => {
  const landing = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=98922105900412026'
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: landing }), semLeitura, LEITORES), { link: `${base}?compra=98922105900412026` })
})

test('link de item é levado para a compra, não para o item', () => {
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: `${base}/item/-3?compra=94300105002432026` }), semLeitura, LEITORES), { link: oficial })
})

test('quando o PNCP não tem o link público, usa o que o cliente cadastrou', () => {
  const r = chatSoNoPortal(auto({ linkOrigem: 'https://pncp.gov.br/app/editais/07954480000179/2026/22924', linkPortal: oficial }), semLeitura, LEITORES)
  assert.deepEqual(r, { link: oficial })
})

test('sem link público: continua "só no portal", mas sem quadro', () => {
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: 'https://pncp.gov.br/app/editais/1/2026/2' }), semLeitura, LEITORES), { link: null })
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: null }), [], LEITORES), { link: null })
})

test('link de outro domínio com ?compra= não vira quadro', () => {
  const falso = 'https://cnetmobile.estaleiro.serpro.gov.br.exemplo.com/comprasnet-web/public/compras/acompanhamento-compra?compra=94300105002432026'
  const http = oficial.replace('https:', 'http:')
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: falso, linkPortal: http }), semLeitura, LEITORES), { link: null })
})

test('POR PREGÃO: saúde ok do comprasgov não esconde o aviso dos pregões da seleção automática', () => {
  // O coletor oficial/assistido só lê os próprios cadastros; o nº do PNCP ninguém lê.
  assert.equal(situacaoLeitura(auto({ linkOrigem: oficial }), lendo, LEITORES), 'so_no_portal')
  assert.deepEqual(chatSoNoPortal(auto({ linkOrigem: oficial }), lendo, LEITORES), { link: oficial })
})

test('cadastro do próprio coletor (comprasgov:<modo>:<chave>) com saúde ok: lido', () => {
  const doColetor = auto({ licitacaoId: 'comprasgov:publico:94300105002432026', linkPortal: oficial })
  assert.equal(situacaoLeitura(doColetor, lendo, LEITORES), 'lido')
  assert.equal(chatSoNoPortal(doColetor, lendo, LEITORES), null)
  // ...e sem saúde ok, volta a ser só visualização.
  assert.equal(situacaoLeitura(doColetor, semLeitura, LEITORES), 'so_no_portal')
})

test('linha do modo API não conta como lida pela saúde do modo público (e vice-versa)', () => {
  const api = auto({ licitacaoId: 'comprasgov:producao:94300105002432026', linkPortal: oficial })
  assert.equal(situacaoLeitura(api, lendo, LEITORES), 'so_no_portal')
  assert.equal(situacaoLeitura(api, lendo, LEITORES, 'comprasgov:producao:'), 'lido')
  const pub = auto({ licitacaoId: 'comprasgov:publico:94300105002432026', linkPortal: oficial })
  assert.equal(situacaoLeitura(pub, lendo, LEITORES, 'comprasgov:producao:'), 'so_no_portal')
})

test('conector comprasgov com sessão em OUTRO portal: sem leitor, e não vira quadro', () => {
  const p = auto({ portal: 'licitanet', linkOrigem: oficial })
  assert.equal(situacaoLeitura(p, semLeitura, LEITORES), 'sem_leitor')
  assert.equal(chatSoNoPortal(p, semLeitura, LEITORES), null)
})

test('portal sem conector (ex.: sigep) é "sem leitor", não "monitoramento ativo"', () => {
  assert.equal(situacaoLeitura({ conectorId: 'sigep', portal: 'sigep', licitacaoId: 'x' }, semLeitura, LEITORES), 'sem_leitor')
  // Sem a lista de leitores, ninguém é dado como lido.
  assert.equal(situacaoLeitura({ conectorId: 'bnc', portal: 'bnc', licitacaoId: 'x' }, semLeitura), 'sem_leitor')
})

test('portalSoVisualizacao: só o Compras.gov.br, e só enquanto nada o lê', () => {
  assert.equal(portalSoVisualizacao('comprasgov', semLeitura), true)
  assert.equal(portalSoVisualizacao('comprasgov', []), true)
  assert.equal(portalSoVisualizacao('comprasgov', lendo), false)
  assert.equal(portalSoVisualizacao('pcp', semLeitura), false)
  assert.equal(portalSoVisualizacao('licitanet', [{ conectorId: 'licitanet', status: 'portal_indisponivel' }]), false)
})

test('saúde ok de OUTRO portal não esconde o aviso do Compras.gov.br', () => {
  assert.deepEqual(chatSoNoPortal(auto({ licitacaoId: 'comprasgov:publico:94300105002432026', linkOrigem: oficial }), [{ conectorId: 'pcp', status: 'ok' }], LEITORES), { link: oficial })
})
