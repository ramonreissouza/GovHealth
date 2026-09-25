// scripts/radar/connector-bll.teste.mjs — a corrida que fazia o BLL/BNC mentir.
//
// O DEFEITO, medido no portal real em 18/09/2026 (navegador frio, 3 páginas, 3 falhas):
// o conector clicava na aba "Mensagens" aos ~4,94 s, assim que o botão ficava VISÍVEL.
// O `onclick` do portal é `doAction(...)`, que por dentro chama `grecaptcha.execute(...)`
// — e `grecaptcha.execute` só vira função aos ~7,1 s. Antes disso o clique morria em
// silêncio, SEM UMA ÚNICA REQUISIÇÃO. O conector via o tbody ausente e gravava
// "o quadro de mensagens não carregou (modal não abriu)": uma frase que manda quem lê
// procurar defeito num seletor que estava certo o tempo todo.
//
// Só a PRIMEIRA página de cada passada é fria. No BNC a falha se escondia no meio das
// outras (falha parcial é tolerada); no BLL, com 1 processo na passada, a primeira era
// a única — e a passada inteira virava `falha` na cara do cliente.
//
// O relógio aqui é virtual de propósito: a suíte não dorme e não toca a rede.

import { lerProcesso, novoEstadoLeitura, urlDeProcesso, ehCompraDireta, HOSTS_PORTAL, resultadoDaPassada } from './connector-bll.mjs'
import { PortalRecusou, usarEsperaDeBackoff } from './connector-base.mjs'

usarEsperaDeBackoff(() => 0)

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const LINHAS = [
  { texto: 'O arquivo EDITAL.pdf foi adicionado ao processo.', horario: '15/06/2026 15:06:21' },
  { texto: 'Assim, ficam encerrados os trabalhos de hoje.', horario: '15/06/2026 18:02:00' },
]

/**
 * Página falsa com RELÓGIO VIRTUAL. Modela a única coisa que importa: o clique só
 * produz efeito depois que o bootstrap do portal terminou.
 *
 * @param {object} cfg
 *  - prontoEm: instante (ms) em que `grecaptcha.execute` vira função (Infinity = portal
 *    sem reCAPTCHA, que é o caso em que a espera NÃO pode virar falha)
 *  - cliquesMortos: quantos cliques iniciais não têm efeito, INDEPENDENTE do bootstrap
 *    (modela o clique perdido por outro motivo — é o que o reclique existe para cobrir)
 *  - modalAbreSemQuadro: o modal abre mas o tbody demora (aqui reclicar FECHARIA o que
 *    está quase pronto — o conector tem de esperar, não insistir)
 *  - status: o que o `goto` responde
 */
function paginaFalsa(cfg = {}) {
  const { prontoEm = 0, cliquesMortos = 0, modalAbreSemQuadro = false, status = 200 } = cfg
  const est = { relogio: 0, cliques: 0, quadro: null, modalAberto: false, esperasDeQuadro: 0 }

  const page = {
    _est: est,
    async goto() { est.relogio += 500; return { status: () => status } },

    locator() {
      return {
        first: () => ({
          async waitFor() { est.relogio += 100 },
          async click() {
            est.cliques++
            if (est.cliques <= cliquesMortos) return          // clique perdido
            if (est.relogio < prontoEm) return                // O DEFEITO: morre calado
            if (modalAbreSemQuadro) { est.modalAberto = true; return }
            est.modalAberto = true
            est.quadro = LINHAS
          },
        }),
      }
    },

    async waitForFunction(_fn, _arg, { timeout } = {}) {
      if (prontoEm <= est.relogio) return true
      if (prontoEm <= est.relogio + timeout) { est.relogio = prontoEm; return true }
      est.relogio += timeout
      throw new Error('timeout')
    },

    async waitForSelector(_sel, { timeout } = {}) {
      est.esperasDeQuadro++
      // O modal lento entrega o tbody na SEGUNDA espera — nunca na primeira.
      if (modalAbreSemQuadro && est.modalAberto && est.esperasDeQuadro >= 2) est.quadro = LINHAS
      if (est.quadro) return true
      est.relogio += timeout
      throw new Error('timeout')
    },

    async waitForTimeout(ms) { est.relogio += ms },

    async evaluate(fn) {
      const src = String(fn)
      if (/genModal|modal\.show/.test(src)) return est.modalAberto
      if (/MsgProcess/.test(src)) return est.quadro
      throw new Error('evaluate inesperado: ' + src.slice(0, 60))
    },
  }
  return page
}

console.log('\nconnector-bll — a corrida do bootstrap\n')

// 1) O CASO DE PRODUÇÃO. Bootstrap aos 2.200 ms; o botão fica visível aos 600 ms.
//    Sem a espera, o clique cai em 600 e morre. Com ela, um clique basta.
{
  const page = paginaFalsa({ prontoEm: 2200 })
  const r = await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x')
  afirmar('página fria: lê as mensagens', r.linhas, LINHAS)
  afirmar('página fria: não precisou reclicar', page._est.cliques, 1)
  afirmar('página fria: esperou o bootstrap antes do clique', page._est.relogio >= 2200, true)
}

// 2) Portal SEM reCAPTCHA. `grecaptcha` nunca aparece; a espera estoura o timeout.
//    Ela é melhor-esforço: travar aqui transformaria uma página que LÊ numa falha.
{
  const page = paginaFalsa({ prontoEm: Infinity })
  // sem bootstrap o clique morreria; aqui o portal não depende dele
  page.locator = () => ({
    first: () => ({
      async waitFor() {},
      async click() { page._est.cliques++; page._est.modalAberto = true; page._est.quadro = LINHAS },
    }),
  })
  const r = await lerProcesso(page, 'https://bnccompras.com/Process/ProcessView?param1=x')
  afirmar('portal sem reCAPTCHA: a espera não vira falha', r.linhas, LINHAS)
}

// 3) Clique perdido por outro motivo, sem modal aberto: o reclique é o que salva.
{
  const page = paginaFalsa({ cliquesMortos: 1 })
  const r = await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x')
  afirmar('clique morto: reclica e lê', r.linhas, LINHAS)
  afirmar('clique morto: exatamente 2 cliques', page._est.cliques, 2)
}

// 4) Modal ABERTO e lento: reclicar fecharia o que já está a caminho. Espera-se mais.
{
  const page = paginaFalsa({ modalAbreSemQuadro: true })
  const r = await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x')
  afirmar('modal lento: lê sem reclicar', r.linhas, LINHAS)
  afirmar('modal lento: NÃO reclicou', page._est.cliques, 1)
}

// 5) Quando o quadro realmente não vem, a mensagem continua sendo a honesta.
{
  const page = paginaFalsa({ cliquesMortos: 9 })
  const r = await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x')
  afirmar('quadro ausente de verdade: reporta falha', r.erro, 'o quadro de mensagens não carregou (modal não abriu)')
  afirmar('quadro ausente de verdade: tentou 2 cliques', page._est.cliques, 2)
}

// 6) RECUSA DO PORTAL. `page.goto` não lança em 403 — sem olhar o status, a recusa
//    chegaria disfarçada de "a aba não apareceu", que foi o erro cometido no Licitanet.
{
  const page = paginaFalsa({ status: 403 })
  let capturado = null
  try { await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x') } catch (e) { capturado = e }
  afirmar('403: lança PortalRecusou', capturado instanceof PortalRecusou, true)
  afirmar('403: carrega o status', capturado?.status, 403)
  afirmar('403: nem tentou clicar', page._est.cliques, 0)
}

// 7) 404 NÃO é recusa do portal: é fato sobre AQUELE processo, e a fila segue.
{
  const page = paginaFalsa({ status: 404 })
  const r = await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x')
  afirmar('404: segue a leitura, não é recusa', r.linhas, LINHAS)
}

// 8) SEM reCAPTCHA, 60 PÁGINAS. A espera de 20 s é por página: sem memória, isto custava
//    60 × 20 s = 20 min a mais por tenant. A primeira página paga a espera inteira e
//    PROVA que o portal não precisa dela (estourou e leu assim mesmo); as outras não.
{
  const estado = novoEstadoLeitura()
  let esperaTotal = 0
  let lidas = 0
  for (let i = 0; i < 60; i++) {
    const page = paginaFalsa({ prontoEm: Infinity })
    page.locator = () => ({
      first: () => ({
        async waitFor() {},
        async click() { page._est.cliques++; page._est.modalAberto = true; page._est.quadro = LINHAS },
      }),
    })
    const antes = page.waitForFunction.bind(page)
    page.waitForFunction = async (fn, arg, opts) => {
      const t0 = page._est.relogio
      try { return await antes(fn, arg, opts) } finally { esperaTotal += page._est.relogio - t0 }
    }
    const r = await lerProcesso(page, 'https://bllcompras.com/Process/ProcessView?param1=x', estado)
    if (r.linhas) lidas++
  }
  afirmar('sem reCAPTCHA: as 60 páginas leem', lidas, 60)
  afirmar('sem reCAPTCHA: a 1ª paga a espera cheia, as outras 59 a curta', esperaTotal, 20000 + 59 * 2000)
  afirmar('sem reCAPTCHA: menos de 3 min de espera no total (era 20 min)', esperaTotal < 3 * 60 * 1000, true)
}

// 9) "O grecaptcha não veio" SOZINHO não prova nada. Se a espera estourou e a leitura
//    FALHOU, a próxima página tem de esperar cheio de novo — senão uma rede lenta na
//    primeira página faria as 59 seguintes clicarem cedo, que é o defeito original.
{
  const estado = novoEstadoLeitura()
  const lenta = paginaFalsa({ prontoEm: Infinity, cliquesMortos: 9 })
  await lerProcesso(lenta, 'https://bllcompras.com/Process/ProcessView?param1=x', estado)
  afirmar('estourou e falhou: NÃO dispensa o bootstrap', estado.bootstrapDispensavel, false)

  // E se o grecaptcha volta a aparecer, a dispensa é revogada.
  estado.bootstrapDispensavel = true
  await lerProcesso(paginaFalsa({ prontoEm: 0 }), 'https://bllcompras.com/Process/ProcessView?param1=x', estado)
  afirmar('grecaptcha voltou: revoga a dispensa', estado.bootstrapDispensavel, false)
}

console.log('\nconnector-bll — só navega para o próprio portal (SSRF)\n')

// 10) A validação era `includes('bllcompras') && /\/Process\//`. Tudo abaixo passava, e
//     a URL vai direto para `page.goto`.
{
  const H = HOSTS_PORTAL.bll
  const casos = [
    ['https://bllcompras.com/Process/ProcessView?param1=x', true],
    ['https://www.bllcompras.com/Process/ProcessView?param1=x', true],
    ['https://BLLCOMPRAS.COM/Process/ProcessView?param1=x', true],
    ['https://bllcompras.com:443/Process/ProcessView?param1=x', true],
    ['https://bllcompras.com.exemplo.net/Process/x', false],
    ['https://exemplo.net/bllcompras.com/Process/x', false],
    ['https://evilbllcompras.com/Process/x', false],
    ['https://x.bllcompras.com/Process/x', false],
    ['http://127.0.0.1/Process/bllcompras.com', false],
    ['http://bllcompras.com/Process/ProcessView?param1=x', false],
    ['https://user:senha@bllcompras.com/Process/x', false],
    ['https://bllcompras.com@127.0.0.1/Process/x', false],
    ['https://bllcompras.com:8080/Process/x', false],
    ['https://169.254.169.254/Process/bllcompras.com', false],
    ['https://bllcompras.com/outra/Process/x', false],
    ['https://bllcompras.com/Home?volta=/Process/x', false],
    ['file:///C:/bllcompras.com/Process/x', false],
    ['javascript:alert(1)//bllcompras.com/Process/', false],
    ['', false],
    [null, false],
  ]
  for (const [url, esperado] of casos) afirmar(`processo ${esperado ? 'aceita' : 'recusa'} ${url}`, urlDeProcesso(url, H), esperado)

  afirmar('BNC não aceita link do BLL', urlDeProcesso('https://bllcompras.com/Process/x', HOSTS_PORTAL.bnc), false)
  afirmar('compra direta reconhecida', ehCompraDireta('https://bnccompras.com/DirectBuy/View?param1=x', HOSTS_PORTAL.bnc), true)
  afirmar('compra direta em host alheio recusada', ehCompraDireta('https://bnccompras.com.evil.io/DirectBuy/x', HOSTS_PORTAL.bnc), false)
}

console.log('\nconnector-bll — leitura parcial não é ok\n')

// 11) Uma página lida e 59 perdidas davam `ok`: verde na tela e verificado_em avançando
//     sobre páginas que ninguém abriu.
{
  const alvos = Array.from({ length: 60 }, (_, i) => ({ licitacaoId: `L${i}` }))
  const base = { nome: 'BLL', alvos, comMensagem: 1, recusa: null, truncados: 0, diretas: 0, credencial: {} }
  const msgs = [{ texto: 'x' }]

  const parcial = resultadoDaPassada({ ...base, mensagens: msgs, falhas: Array.from({ length: 59 }, (_, i) => `L${i + 1}: timeout`) })
  afirmar('59 de 60 falharam: NÃO é ok', parcial.status, 'falha')
  afirmar('parcial: preserva o que foi lido', parcial.mensagens.length, 1)
  afirmar('parcial: diz que foi parcial e quanto', parcial.detalhe.startsWith('leitura parcial: 1 de 60'), true)
  afirmar('parcial: diz o motivo', parcial.detalhe.includes('L1: timeout'), true)

  const umaSo = resultadoDaPassada({ ...base, mensagens: msgs, falhas: ['L7: a aba "Mensagens" não apareceu na página'] })
  afirmar('1 de 60 falhou: também não é ok', umaSo.status, 'falha')

  const todas = resultadoDaPassada({ ...base, mensagens: [], falhas: alvos.map((a) => `${a.licitacaoId}: x`) })
  afirmar('todas falharam: falha', todas.status, 'falha')

  const limpa = resultadoDaPassada({ ...base, mensagens: msgs, falhas: [] })
  afirmar('nenhuma falha: ok', limpa.status, 'ok')

  const recusa = resultadoDaPassada({ ...base, mensagens: msgs, falhas: [], recusa: { status: 429 } })
  afirmar('recusa do portal continua portal_indisponivel', recusa.status, 'portal_indisponivel')

  // O rodízio (rodizio.mjs) avança por `lidos`. Se a regra do status o perdesse, a
  // passada seguinte recomeçaria do 1º — o defeito que o rodízio existe para matar.
  const comLidos = resultadoDaPassada({ ...base, mensagens: msgs, falhas: ['L9: x'], lidos: 59 })
  afirmar('parcial: carrega `lidos` para o rodízio', comLidos.lidos, 59)
  afirmar('ok: carrega `lidos`', resultadoDaPassada({ ...base, mensagens: msgs, falhas: [], lidos: 60 }).lidos, 60)
  afirmar('recusa: carrega `lidos`', resultadoDaPassada({ ...base, mensagens: msgs, falhas: [], lidos: 21, recusa: { status: 429 } }).lidos, 21)

  // E `consumidos`, que é o que o rodízio avança agora (revisão da #38). Em TODOS os
  // ramos — inclusive "todas falharam", que é justamente o lote que prendia o ponto.
  const cons = (extra) => resultadoDaPassada({ ...base, mensagens: msgs, falhas: [], consumidos: 60, ...extra }).consumidos
  afirmar('ok: carrega `consumidos`', cons({}), 60)
  afirmar('parcial: carrega `consumidos`', cons({ falhas: ['L1: x'] }), 60)
  afirmar('todas falharam: carrega `consumidos`', cons({ mensagens: [], falhas: alvos.map((a) => `${a.licitacaoId}: x`) }), 60)
  afirmar('recusa: carrega `consumidos`', cons({ consumidos: 21, recusa: { status: 429 } }), 21)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
