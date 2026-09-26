import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerLink, candidatosNoPncp } from '../../src/lib/radar/link-processo.mjs'
import { urlDeProcesso as urlBllBnc, HOSTS_PORTAL } from './connector-bll.mjs'
import { urlDeSessao } from './connector-licitanet.mjs'
import { urlDePesquisa } from './connector-ammlicita.mjs'
import { urlDeEdital } from './connector-egovrs.mjs'
import { urlDeProcesso as urlComprasbr } from './connector-comprasbr.mjs'

// O que a tela passa: LEITORES de lib/radar/conectores.ts (disponível, público, sem o comprasgov).
const LEITORES = ['pcp', 'bll', 'licitanet', 'ammlicita', 'bnc', 'egovrs', 'banrisul', 'comprasbr']

// O validador que o COLETOR usa para decidir se navega. O link que sai de lerLink tem de
// passar nele: aceitar o que o coletor descarta deixava o pregão esperando leitura nenhuma.
const DO_COLETOR = {
  bll: (u) => urlBllBnc(u, HOSTS_PORTAL.bll),
  bnc: (u) => urlBllBnc(u, HOSTS_PORTAL.bnc),
  licitanet: urlDeSessao,
  ammlicita: urlDePesquisa,
  egovrs: urlDeEdital,
  banrisul: urlDeEdital,
  comprasbr: urlComprasbr,
  // run.mjs (resolverUrlsPCP): o link colado vale se contém este trecho.
  pcp: (u) => String(u).includes('portaldecompraspublicas.com.br/processos'),
}

const VALIDOS = [
  ['bll', 'https://bllcompras.com/Process/ProcessView?param1=%5Bgkz%5DabcDEF'],
  ['bll', 'http://www.bllcompras.com/Process/ProcessView?param1=x#topo'],
  ['bll', 'BLLCOMPRAS.COM/Process/ProcessView?param1=x'],
  ['bnc', 'https://bnccompras.com/Process/ProcessView?param1=x'],
  ['licitanet', 'https://licitanet.com.br/sessao/202695'],
  ['licitanet', 'licitanet.com.br/sessao/12'],
  ['licitanet', 'https://portal.licitanet.com.br/Sessao/12/detalhe'],
  ['ammlicita', 'https://app2.ammlicita.org.br/pesquisa/987'],
  ['egovrs', 'https://www.compras.rs.gov.br/editais/0452_2026/356155'],
  ['banrisul', 'https://pregaobanrisul.com.br/editais/0022_2026/355957'],
  ['comprasbr', 'https://comprasbr.com.br/pregao-eletronico-detalhe/?idlicitacao=48015'],
  ['comprasbr', 'https://app.comprasbr.com.br/x/?a=1&IDLICITACAO=47931'],
  ['pcp', 'https://www.portaldecompraspublicas.com.br/processos/sp/autarquia-municipal-de-saude-de-itapecerica-da-serra-1261/pe-pregao-eletronico-no-010-2024-2024-297860'],
  ['pcp', 'http://portaldecompraspublicas.com.br/processos/mg/prefeitura-x-1/pe-1-2026'],
]

test('link válido: o portal certo, e o link salvo passa no validador do coletor', () => {
  for (const [esperado, link] of VALIDOS) {
    const r = lerLink(link, LEITORES)
    assert.equal(r.tipo, 'portal', `${link} → ${JSON.stringify(r)}`)
    assert.equal(r.conectorId, esperado, link)
    assert.ok(r.url.startsWith('https://'), `sempre https: ${r.url}`)
    assert.ok(!r.url.includes('#'), `sem fragmento: ${r.url}`)
    assert.ok(DO_COLETOR[esperado](r.url), `o coletor ${esperado} recusaria ${r.url}`)
    assert.ok(r.idPortal, `id do portal vazio em ${link}`)
  }
})

test('todo conector que o Radar lê tem regra de link', () => {
  const cobertos = new Set(VALIDOS.map(([id]) => id))
  for (const id of LEITORES) assert.ok(cobertos.has(id), `sem exemplo aceito para ${id}`)
  for (const id of LEITORES) assert.ok(DO_COLETOR[id], `sem validador do coletor para ${id}`)
})

test('host conferido de verdade: o domínio no meio do texto não basta', () => {
  // Todos estes passam no validador do coletor (substring) e nenhum é do portal.
  for (const link of [
    'https://evil.com/?x=licitanet.com.br/sessao/1',
    'https://licitanet.com.br.evil.com/sessao/1',
    'https://notlicitanet.com.br/sessao/1',
    'https://evil.com/editais/a/1?r=compras.rs.gov.br',
    'https://compras.rs.gov.br.evil.com/editais/a/1',
    'https://evil.com/?a=comprasbr.com.br&idlicitacao=5',
    'https://evil.com/?u=portaldecompraspublicas.com.br/processos/sp/a/b',
    'https://evilbllcompras.com/Process/x?param1=1',
    'https://x.bllcompras.com/Process/x?param1=1',
  ]) {
    const r = lerLink(link, LEITORES)
    assert.equal(r.tipo, 'erro', `${link} → ${JSON.stringify(r)}`)
  }
})

test('endereço que não é página de pregão: diz o que colar, com exemplo', () => {
  const casos = [
    'https://bllcompras.com/Process/ProcessView',             // sem param1
    'https://bllcompras.com/Home',
    'https://licitanet.com.br/processos/12',
    'https://www.portaldecompraspublicas.com.br/processos',    // a listagem, não um pregão
    'https://www.portaldecompraspublicas.com.br/processos/tabela/?page=1',
    'https://www.portaldecompraspublicas.com.br/Processos/sp/x/y', // o coletor diferencia maiúsculas
    'https://www.compras.rs.gov.br/',
    'https://comprasbr.com.br/licitacao-pub/#/detalhe/48015',
  ]
  for (const link of casos) {
    const r = lerLink(link, LEITORES)
    assert.equal(r.tipo, 'erro', link)
    assert.equal(r.motivo, 'formato', `${link} → ${r.motivo}`)
  }
  const direta = lerLink('https://bnccompras.com/DirectBuy/View?param1=x', LEITORES)
  assert.equal(direta.motivo, 'formato')
  assert.match(direta.mensagem, /compra direta/i)
})

test('o que não é link, ou é link que ninguém abriria', () => {
  assert.equal(lerLink('', LEITORES).tipo, 'vazio')
  assert.equal(lerLink('   ', LEITORES).tipo, 'vazio')
  for (const link of ['pregão de luvas', 'javascript:alert(1)//licitanet.com.br/sessao/1', 'ftp://licitanet.com.br/sessao/1',
    'file:///C:/bllcompras.com/Process/x', 'https://user:senha@bllcompras.com/Process/x?param1=1',
    'https://bllcompras.com:8080/Process/x?param1=1']) {
    const r = lerLink(link, LEITORES)
    assert.equal(r.tipo, 'erro', link)
    assert.equal(r.motivo, 'nao_e_link', `${link} → ${r.motivo}`)
  }
})

test('portal que o Radar não está lendo agora: sem_leitor, não "desconhecido"', () => {
  const r = lerLink('https://licitanet.com.br/sessao/1', LEITORES.filter((id) => id !== 'licitanet'))
  assert.equal(r.tipo, 'erro')
  assert.equal(r.motivo, 'sem_leitor')
})

test('Compras.gov.br: o link público vira o endereço canônico, mesmo sem leitor', () => {
  const canon = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=94300105002432026'
  for (const link of [
    canon,
    'http://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=94300105002432026',
    'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=94300105002432026',
    'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/-3?compra=94300105002432026',
  ]) {
    const r = lerLink(link, [])
    assert.equal(r.tipo, 'portal', link)
    assert.equal(r.conectorId, 'comprasgov')
    assert.equal(r.url, canon)
    assert.equal(r.idPortal, '94300105002432026')
    assert.equal(r.descricao, 'compra 00243/2026 · UASG 943001')
  }
  const outra = lerLink('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras', LEITORES)
  assert.equal(outra.motivo, 'formato')
  assert.match(outra.mensagem, /acompanhamento/)
  assert.equal(lerLink('https://www.comprasnet.gov.br/seguro/loginPortal.asp', LEITORES).motivo, 'formato')
})

test('link do edital no PNCP vira o nº de controle', () => {
  assert.deepEqual(lerLink('https://pncp.gov.br/app/editais/02451938000153/2026/190', LEITORES),
    { tipo: 'pncp', numeroControle: '02451938000153-1-000190/2026' })
  assert.deepEqual(lerLink('pncp.gov.br/app/editais/02451938000153/2026/000190/', LEITORES),
    { tipo: 'pncp', numeroControle: '02451938000153-1-000190/2026' })
  // Outras páginas do PNCP não são edital.
  assert.equal(lerLink('https://pncp.gov.br/app/editais?q=luvas', LEITORES).tipo, 'erro')
  assert.equal(lerLink('https://pncp.gov.br/app/editais/123/2026/1', LEITORES).tipo, 'erro')
})

test('texto colado depois do link, ou pontuação da frase, não entra no endereço', () => {
  const r = lerLink('https://bllcompras.com/Process/ProcessView?param1=abcDEF Pregão 12/2026', LEITORES)
  assert.equal(r.tipo, 'portal')
  assert.equal(r.url, 'https://bllcompras.com/Process/ProcessView?param1=abcDEF')
  assert.equal(r.idPortal, 'abcDEF')
  assert.equal(lerLink('https://licitanet.com.br/sessao/202695).', LEITORES).url, 'https://licitanet.com.br/sessao/202695')
})

test('outra página do PNCP: diz qual link do PNCP serve', () => {
  const r = lerLink('https://pncp.gov.br/app/atas/02451938000153/2026/190/1', LEITORES)
  assert.equal(r.motivo, 'formato')
  assert.match(r.mensagem, /app\/editais/)
})

test('candidatosNoPncp tenta os dois formatos do Compras.gov.br, sem repetir', () => {
  const colado = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=94300105002432026'
  const c = candidatosNoPncp(colado, lerLink(colado, []))
  assert.deepEqual(c, [
    colado,
    'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/landing?destino=acompanhamento-compra&compra=94300105002432026',
  ])
  const lic = lerLink('http://licitanet.com.br/sessao/9', LEITORES)
  assert.deepEqual(candidatosNoPncp('http://licitanet.com.br/sessao/9', lic), ['http://licitanet.com.br/sessao/9', 'https://licitanet.com.br/sessao/9'])
})
