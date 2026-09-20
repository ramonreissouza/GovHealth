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

import { lerProcesso } from './connector-bll.mjs'
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

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
