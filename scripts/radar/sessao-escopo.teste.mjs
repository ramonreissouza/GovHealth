// scripts/radar/sessao-escopo.teste.mjs — o recorte do cofre, sem rede e sem banco.
//
// O caso 3 é O TESTE QUE MORDE: ele usa a sessão REAL medida no cofre de produção em
// 22/09/2026 (9 cookies do `sso.acesso.gov.br` + 2 do `www.comprasnet.gov.br`, só os
// nomes, nenhum valor) e exige que os 9 do SSO não sobrevivam. Se alguém um dia
// acrescentar `gov.br` à lista de domínios, ou trocar a comparação por `includes`, é
// aqui que quebra — e não no cofre de um cliente.

import {
  recortarSessao, dominiosDoPortal, dominioEspecificoBastante,
  resumoDescarte, serializarSessaoRecortada,
} from './sessao-escopo.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const ck = (domain, name) => ({ domain, name, value: 'x', path: '/' })

// 1) O SUFIXO PÚBLICO NÃO PODE ENTRAR NA LISTA ───────────────────────────────────────
//    `gov.br` casaria com `sso.acesso.gov.br`, `com.br` com o país inteiro. A guarda
//    existe para que um domínio genérico falhe ALTO, e não anule o recorte em silêncio.
{
  afirmar('gov.br é generico demais', dominioEspecificoBastante('gov.br'), false)
  afirmar('com.br é generico demais', dominioEspecificoBastante('com.br'), false)
  afirmar('comprasnet.gov.br serve', dominioEspecificoBastante('comprasnet.gov.br'), true)
  afirmar('bllcompras.com serve', dominioEspecificoBastante('bllcompras.com'), true)
  afirmar('vazio nao serve', dominioEspecificoBastante(''), false)
  afirmar('url inteira nao serve', dominioEspecificoBastante('https://x.gov.br/a'), false)
}

// 2) A LISTA DO comprasgov NÃO INCLUI O SSO ──────────────────────────────────────────
{
  const lista = dominiosDoPortal('comprasgov')
  afirmar('comprasgov: sem sso.acesso.gov.br', lista.includes('sso.acesso.gov.br'), false)
  afirmar('comprasgov: sem serpro.gov.br solto', lista.includes('serpro.gov.br'), false)
  afirmar('comprasgov: com comprasnet.gov.br', lista.includes('comprasnet.gov.br'), true)
  afirmar('comprasgov: com o host da SPA', lista.includes('cnetmobile.estaleiro.serpro.gov.br'), true)
}

// 3) A SESSÃO REAL DE PRODUÇÃO (22/09/2026) ──────────────────────────────────────────
//    Só os nomes; nenhum valor de cookie aparece neste repositório.
{
  const real = {
    cookies: [
      ck('.sso.acesso.gov.br', 'Session_Gov_Br_Prod'),
      ck('.sso.acesso.gov.br', 'INGRESSCOOKIE'),
      ck('.sso.acesso.gov.br', 'TS0185eea4'),
      ck('.sso.acesso.gov.br', 'Govbrid'),
      ck('.sso.acesso.gov.br', 'GovbrUid_fooab4Zj16p8n7cc'),
      ck('sso.acesso.gov.br', 'TS00000000076'),
      ck('sso.acesso.gov.br', 'TSPD_101_DID'),
      ck('sso.acesso.gov.br', 'TS0197b850'),
      ck('sso.acesso.gov.br', 'TSd2153684027'),
      ck('www.comprasnet.gov.br', 'ASPSESSIONIDAGBRCSCD'),
      ck('www.comprasnet.gov.br', 'ASPSESSIONIDCGAQBSDD'),
    ],
    origins: [],
  }
  const r = recortarSessao(real, 'comprasgov')
  afirmar('sobram exatamente os 2 do comprasnet', r.mantidos, 2)
  afirmar('os que sobram sao os ASPSESSIONID',
    r.estado.cookies.map((c) => c.name).sort(), ['ASPSESSIONIDAGBRCSCD', 'ASPSESSIONIDCGAQBSDD'])
  afirmar('nenhum cookie do SSO sobreviveu',
    r.estado.cookies.some((c) => /acesso\.gov\.br/.test(c.domain)), false)
  afirmar('o descarte foi contado e nomeado', resumoDescarte(r.descartados), 'sso.acesso.gov.br:9')
  afirmar('a entrada nao foi mutada', real.cookies.length, 11)
}

// 4) A SESSÃO SÓ-ANALYTICS VIRA VAZIA ────────────────────────────────────────────────
//    Duas linhas do cofre de produção guardavam só `_ga` do `.serpro.gov.br`. Depois do
//    recorte não sobra nada — e `sessaoTemCredencial` passa a reprovar, que é o certo:
//    um cofre honestamente vazio é melhor que um cofre com lixo cifrado.
{
  const lixo = { cookies: [ck('.serpro.gov.br', '_ga'), ck('.serpro.gov.br', '_ga_623FPXHZ7K')], origins: [] }
  const r = recortarSessao(lixo, 'comprasgov')
  afirmar('analytics do .serpro.gov.br nao passa', r.mantidos, 0)
  afirmar('e o descarte diz de onde veio', resumoDescarte(r.descartados), 'serpro.gov.br:2')
}

// 5) O SUBDOMÍNIO CERTO PASSA; O IRMÃO NÃO ───────────────────────────────────────────
//    `cnetmobile.estaleiro.serpro.gov.br` está na lista por extenso. Um outro host
//    dentro de `serpro.gov.br` NÃO pode entrar de carona.
{
  const s = {
    cookies: [
      ck('cnetmobile.estaleiro.serpro.gov.br', 'JSESSIONID'),
      ck('outroservico.serpro.gov.br', 'algumaCoisa'),
      ck('.comprasnet.gov.br', 'ASPSESSIONIDX'),
    ],
    origins: [],
  }
  const r = recortarSessao(s, 'comprasgov')
  afirmar('o host da SPA passa', r.estado.cookies.some((c) => c.name === 'JSESSIONID'), true)
  afirmar('o ponto inicial nao atrapalha', r.estado.cookies.some((c) => c.name === 'ASPSESSIONIDX'), true)
  afirmar('o irmao no serpro nao entra de carona',
    r.estado.cookies.some((c) => c.name === 'algumaCoisa'), false)
}

// 6) localStorage TAMBÉM É RECORTADO ─────────────────────────────────────────────────
//    SPA guarda token em localStorage. Filtrar só cookie deixaria a metade cara passar.
{
  const s = {
    cookies: [],
    origins: [
      { origin: 'https://sso.acesso.gov.br', localStorage: [{ name: 'id_token', value: 'a' }] },
      { origin: 'https://www.comprasnet.gov.br', localStorage: [{ name: 'perfil', value: 'b' }] },
    ],
  }
  const r = recortarSessao(s, 'comprasgov')
  afirmar('sobra so a origin do portal', r.estado.origins.map((o) => o.origin), ['https://www.comprasnet.gov.br'])
  afirmar('a origin do SSO foi contada no descarte', resumoDescarte(r.descartados), 'sso.acesso.gov.br:1')
}

// 7) PORTAL SEM LISTA EXPLÍCITA DERIVA DO REGISTRO ───────────────────────────────────
//    Os outros nove portais não precisam de entrada na tabela: os hosts saem de
//    `loginUrl`/`areaUrl`, que é justamente onde o conector navega.
{
  const lista = dominiosDoPortal('bll')
  afirmar('bll deriva o host do registro', lista, ['bllcompras.com'])
  const r = recortarSessao({
    cookies: [ck('bllcompras.com', '.AspNet.ApplicationCookie'), ck('google-analytics.com', '_ga')],
    origins: [],
  }, 'bll')
  afirmar('bll: mantem o proprio, descarta o resto', r.mantidos, 1)
}

// 8) PORTAL DESCONHECIDO NÃO APAGA A SESSÃO ──────────────────────────────────────────
//    Recortar contra lista vazia transformaria ganho de privacidade em perda de
//    serviço. Devolve intacto e DIZ que não recortou.
{
  const s = { cookies: [ck('qualquer.coisa.com', 'a')], origins: [] }
  const r = recortarSessao(s, 'portal-que-nao-existe')
  afirmar('sem lista: nao recorta', r.mantidos, 1)
  afirmar('sem lista: deixa rastro', r.semLista, 'portal-que-nao-existe')
}

// 9) O SERIALIZADOR AVISA QUEM CHAMOU ────────────────────────────────────────────────
{
  let visto = null
  const { json, mantidos } = serializarSessaoRecortada(
    { cookies: [ck('sso.acesso.gov.br', 'Govbrid'), ck('www.comprasnet.gov.br', 'ASPSESSIONIDX')], origins: [] },
    'comprasgov',
    { aoDescartar: (d) => { visto = d } },
  )
  afirmar('serializa o recortado', JSON.parse(json).cookies.length, 1)
  afirmar('conta o mantido', mantidos, 1)
  afirmar('avisa o descarte', visto, [{ dominio: 'sso.acesso.gov.br', n: 1 }])
}

// 10) ESVAZIAR A SESSÃO É BARULHO, NÃO SILÊNCIO ─────────────────────────────────────
//     O cookie no domínio-PAI (`.bb.com.br` para `licitacoes-e2.bb.com.br`) não passa,
//     de propósito: aceitar o pai reabriria o `serpro.gov.br` com o analytics junto.
//     O caso tem de GRITAR, porque um cofre vazio sem explicação é o modo de falha que
//     este repositório já pagou caro. Aqui só se exige que o aviso saia nomeando o
//     domínio — quem for consertar precisa saber qual host acrescentar à lista.
{
  const originalWarn = console.warn
  let avisos = []
  console.warn = (...a) => avisos.push(a.join(' '))
  try {
    serializarSessaoRecortada({ cookies: [ck('.bb.com.br', 'JSESSIONID')], origins: [] }, 'licitacoes-e')
  } finally { console.warn = originalWarn }
  afirmar('esvaziou: avisa', avisos.length, 1)
  afirmar('esvaziou: o aviso nomeia o dominio', /bb\.com\.br:1/.test(avisos[0] ?? ''), true)

  // E o caso normal NÃO avisa — um aviso que sai sempre não é lido.
  const originalWarn2 = console.warn
  avisos = []
  console.warn = (...a) => avisos.push(a.join(' '))
  try {
    serializarSessaoRecortada(
      { cookies: [ck('sso.acesso.gov.br', 'Govbrid'), ck('www.comprasnet.gov.br', 'ASPSESSIONIDX')], origins: [] },
      'comprasgov')
  } finally { console.warn = originalWarn2 }
  afirmar('sobrou algo: nao avisa', avisos.length, 0)
}

// 11) O ESCAPE HATCH É EXPLÍCITO E REVERSÍVEL ────────────────────────────────────────
{
  process.env.RADAR_SESSAO_MANTER_SSO = '1'
  const r = recortarSessao({ cookies: [ck('sso.acesso.gov.br', 'Govbrid')], origins: [] }, 'comprasgov')
  afirmar('com a variavel ligada, nada e recortado', r.mantidos, 1)
  delete process.env.RADAR_SESSAO_MANTER_SSO
  const r2 = recortarSessao({ cookies: [ck('sso.acesso.gov.br', 'Govbrid')], origins: [] }, 'comprasgov')
  afirmar('desligada, o recorte volta', r2.mantidos, 0)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
