// scripts/radar/capture.teste.mjs — a ida à área depois do login, que se perdia calada.
//
// O DEFEITO: `levadoAArea = true` vinha ANTES do `page.goto`, e o `goto` tinha
// `.catch(() => {})`. Um timeout na única ida deixava o usuário na landing do SSO, nada
// tentava de novo pelos ~900 s restantes, e a janela terminava em `sessao_expirada` —
// dizendo a quem fez o login certo que ele não fez.
//
// Relógio virtual: cada `waitForTimeout` avança o tempo, nada dorme, nada toca rede.

import { aguardarLogin, TENTATIVAS_AREA } from './capture.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const AREA = 'https://portal.exemplo/area'
const LANDING = 'https://sso.exemplo/landing'
const meta = {
  nome: 'Portal',
  areaUrl: AREA,
  emLogin: ({ url }) => /\/login/.test(url),
  logado: ({ url }) => url === AREA,
}

/**
 * @param {object} cfg
 *  - gotosQueFalham: quantos `goto` à área estouram antes de um dar certo (Infinity = nunca)
 *  - urlInicial: onde o usuário está quando o login termina
 */
function paginaFalsa({ gotosQueFalham = 0, urlInicial = LANDING } = {}) {
  const est = { relogio: 0, url: urlInicial, gotos: 0 }
  return {
    _est: est,
    agora: () => est.relogio,
    async waitForTimeout(ms) { est.relogio += ms },
    url: () => est.url,
    async content() { return '' },
    async goto(url) {
      est.gotos++
      est.relogio += 1000
      if (est.gotos <= gotosQueFalham) throw new Error('page.goto: Timeout 30000ms exceeded.')
      est.url = url
    },
  }
}

console.log('\ncapture — a ida à área depois do login\n')

// 1) Caminho feliz: uma ida, login detectado.
{
  const page = paginaFalsa()
  const r = await aguardarLogin(page, meta, { deadlineMs: 900_000, agora: page.agora })
  afirmar('feliz: logado', r.logado, true)
  afirmar('feliz: uma ida à área', page._est.gotos, 1)
}

// 2) O CASO DO REVISOR: a 1ª ida estoura. Antes, fim da linha; agora, tenta de novo.
{
  const page = paginaFalsa({ gotosQueFalham: 1 })
  const r = await aguardarLogin(page, meta, { deadlineMs: 900_000, agora: page.agora })
  afirmar('1ª ida estourou: ainda assim loga', r.logado, true)
  afirmar('1ª ida estourou: tentou de novo', page._est.gotos, 2)
}

// 3) Portal fora do ar de verdade: tenta poucas vezes, não martela, e diz que foi
//    TRANSPORTE — o chamador transforma isso em `portal_indisponivel`.
{
  const page = paginaFalsa({ gotosQueFalham: Infinity })
  const r = await aguardarLogin(page, meta, { deadlineMs: 900_000, agora: page.agora })
  afirmar('portal fora: não logou', r.logado, false)
  afirmar(`portal fora: parou em ${TENTATIVAS_AREA} tentativas`, page._est.gotos, TENTATIVAS_AREA)
  afirmar('portal fora: devolve o erro de transporte', /Timeout/.test(r.erroNavegacao ?? ''), true)
}

// 4) Usuário ainda no login (2FA em curso): NÃO navega — interromperia o humano.
//    E, sem ida nenhuma, o fim é `sessao_expirada` de verdade (sem erro de transporte).
{
  const page = paginaFalsa({ urlInicial: 'https://sso.exemplo/login' })
  const r = await aguardarLogin(page, meta, { deadlineMs: 30_000, agora: page.agora })
  afirmar('no login: não navegou', page._est.gotos, 0)
  afirmar('no login: não logou', r.logado, false)
  afirmar('no login: sem erro de transporte (é sessão, não rede)', r.erroNavegacao, null)
}

// 5) Falhou uma vez e depois deu certo, mas o detector não reconheceu a área: o erro
//    antigo NÃO pode sobrar e virar `portal_indisponivel` — a navegação funcionou.
{
  const page = paginaFalsa({ gotosQueFalham: 1 })
  const metaCego = { ...meta, logado: () => false }
  const r = await aguardarLogin(page, metaCego, { deadlineMs: 60_000, agora: page.agora })
  afirmar('navegou depois de falhar: o erro velho é esquecido', r.erroNavegacao, null)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
