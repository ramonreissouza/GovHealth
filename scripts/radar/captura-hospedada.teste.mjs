// scripts/radar/captura-hospedada.teste.mjs — a ordem: decidir, limpar, gravar.
//
// O DEFEITO (revisão da #38): o browser-service limpava o navegador e desconectava
// ANTES de decidir se o login tinha terminado. Com o recorte deixando a sessão sem
// credencial, a resposta era "login em curso" — com o login do fornecedor já apagado.
//
// Sem navegador e sem banco: o contexto, o browser e cada dependência só registram o que
// foi chamado, e em que ordem.

import { concluirCaptura } from './captura-hospedada.mjs'
import { ACAO_BYPASS_SSO } from './sessao-escopo.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const ck = (domain, name) => ({ name, value: 'v', domain, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' })
const SSO = ck('sso.acesso.gov.br', 'Govbrid')
const PORTAL = ck('www.comprasnet.gov.br', 'ASPSESSIONIDQA')

function cenario({ cookies, url = 'https://www.comprasnet.gov.br/seguro/area', conector = 'comprasgov' }) {
  const eventos = []
  const pagina = { url: () => url }
  const ctx = {
    pages: () => [pagina],
    async storageState() { return { cookies, origins: [] } },
  }
  const browser = { async close() { eventos.push('desconectar') } }
  const gravado = { storage: null, sql: [] }
  const deps = {
    async limparEstado() { eventos.push('limpar') },
    async q(sql, params) {
      gravado.sql.push(sql)
      if (/SET storage_state=/.test(sql)) { eventos.push('gravar_cofre'); gravado.storage = params[1] }
      else if (/radar_auditoria/.test(sql)) eventos.push(`auditar:${params[1] ?? JSON.parse(params[2] ?? '{}').via}`)
      else if (/conexao_status='erro'/.test(sql)) eventos.push('marcar_erro')
      return []
    },
    async marcarSaude(_c, status) { eventos.push(`saude:${status}`) },
    async encerrarSessao() { eventos.push('encerrar') },
    soltar() { eventos.push('soltar') },
    cifrar: (json) => `cifrado(${json})`,
  }
  const cred = { id: 'c1', titular_id: 't1', conector_id: conector, conexao_session_id: 's1' }
  return { alvo: { ctx, browser, cred, credencialId: 'c1' }, deps, eventos, gravado }
}

console.log('\ncaptura-hospedada — decidir, limpar, gravar\n')

// 1) O CASO DA REVISÃO: só o SSO no navegador (o fornecedor clicou "já concluí" no meio
//    do 2FA). O recorte zera, e o login do fornecedor tem de CONTINUAR vivo.
{
  const c = cenario({ cookies: [SSO] })
  const r = await concluirCaptura(c.alvo, c.deps)
  afirmar('login em curso: responde conectando', r.conexao, 'conectando')
  afirmar('login em curso: NÃO limpa o navegador', c.eventos.includes('limpar'), false)
  afirmar('login em curso: NÃO encerra a sessão do steel', c.eventos.includes('encerrar'), false)
  afirmar('login em curso: NÃO solta a pista', c.eventos.includes('soltar'), false)
  afirmar('login em curso: não grava o cofre', c.gravado.storage, null)
  afirmar('login em curso: só desconecta do CDP', c.eventos.filter((e) => e === 'desconectar').length, 1)
}

// 2) Ainda na tela de login do gov.br, mesmo com cookie do portal: também é "em curso".
{
  const c = cenario({ cookies: [PORTAL, SSO], url: 'https://sso.acesso.gov.br/login' })
  const r = await concluirCaptura(c.alvo, c.deps)
  afirmar('na tela de login: conectando, sem limpar', [r.conexao, c.eventos.includes('limpar')], ['conectando', false])
}

// 3) Login concluído: limpa ANTES de gravar, e o cofre sai recortado.
{
  const c = cenario({ cookies: [PORTAL, SSO] })
  const r = await concluirCaptura(c.alvo, c.deps)
  afirmar('concluído: conectado', r.conexao, 'conectado')
  const i = (e) => c.eventos.indexOf(e)
  afirmar('concluído: limpa antes de gravar', i('limpar') >= 0 && i('limpar') < i('gravar_cofre'), true)
  afirmar('concluído: desconecta antes de gravar', i('desconectar') < i('gravar_cofre'), true)
  afirmar('concluído: o SSO NÃO vai para o cofre', /Govbrid/.test(c.gravado.storage ?? ''), false)
  afirmar('concluído: o cookie do portal vai', /ASPSESSIONIDQA/.test(c.gravado.storage ?? ''), true)
  afirmar('concluído: encerra e solta depois de gravar', i('encerrar') > i('gravar_cofre') && i('soltar') > i('gravar_cofre'), true)
  afirmar('concluído: sem bypass, sem auditoria de bypass', c.eventos.some((e) => e.includes(ACAO_BYPASS_SSO)), false)
}

// 4) Portal sem política de domínios: nunca vai poder gravar. Encerra e diz por quê —
//    em vez de "login em curso" para sempre.
{
  const erroOriginal = console.error
  console.error = () => {}
  let c, r
  try {
    c = cenario({ cookies: [PORTAL, SSO], conector: 'portal-sem-lista' })
    r = await concluirCaptura(c.alvo, c.deps)
  } finally { console.error = erroOriginal }
  afirmar('sem política: erro explícito', r.status, 422)
  afirmar('sem política: não grava o cofre', c.gravado.storage, null)
  afirmar('sem política: limpa, encerra e solta', ['limpar', 'encerrar', 'soltar'].every((e) => c.eventos.includes(e)), true)
  afirmar('sem política: marca o erro na credencial', c.eventos.includes('marcar_erro'), true)
}

// 5) Bypass ligado (duas chaves): grava inteiro, mas deixa o rastro em radar_auditoria.
{
  const salvo = { ...process.env }
  const erroOriginal = console.error
  console.error = () => {}
  let c
  try {
    process.env.RADAR_SESSAO_MANTER_SSO = '1'
    process.env.RADAR_DIAGNOSTICO = '1'
    delete process.env.NODE_ENV
    c = cenario({ cookies: [PORTAL, SSO] })
    await concluirCaptura(c.alvo, c.deps)
  } finally {
    console.error = erroOriginal
    for (const k of ['RADAR_SESSAO_MANTER_SSO', 'RADAR_DIAGNOSTICO', 'NODE_ENV']) {
      if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]
    }
  }
  afirmar('bypass: audita o uso', c.eventos.includes(`auditar:${ACAO_BYPASS_SSO}`), true)
  afirmar('bypass: a auditoria vem depois da gravação', c.eventos.indexOf(`auditar:${ACAO_BYPASS_SSO}`) > c.eventos.indexOf('gravar_cofre'), true)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
