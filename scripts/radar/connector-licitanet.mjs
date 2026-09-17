// scripts/radar/connector-licitanet.mjs — conector do LICITANET (MODO PÚBLICO, sem login).
//
// O Licitanet publica a sessão inteira em /sessao/<id>, sob o título "Sessão Pública —
// Visualize o andamento do processo licitatório". O painel "Mensagens · Comunicação da
// sessão" abre para qualquer um, sem conta e sem cookie. Medido em 13/09/2026.
//
// É o portal com as mensagens mais ÚTEIS dos que já ligamos. Não é log de arquivo: é a
// comunicação do certame, com prazo dentro do texto. Exemplos capturados sem login:
//
//   "o Processo nº 040/2026 foi SUSPENSO. A REABERTURA será no dia 24/09/2026 09:00"
//   "A manifestação de Intenção de Recurso de (…) foi recebida (…) razões até 17/09/2026
//    e os outros interessados contrarrazões até 22/09/2026"
//   "o Processo nº 021/2026 foi REVOGADO pelo seguinte motivo: Em anexo."
//
// COMO SE LÊ (seguido do DOM real, não adivinhado):
//   · o painel só RENDERIZA quando entra em tela — a página é Vue e monta o bloco sob
//     demanda. Sem rolar até "Comunicação da sessão", o DOM não tem mensagem nenhuma, e
//     o conector leria zero achando que leu;
//   · cada mensagem é um bloco com <header> contendo o autor, opcionalmente o lote
//     (<span aria-label="Mensagem do lote ITEM-02">) e um <time datetime="…"> em ISO;
//   · o texto é o que vem depois do header.
//
// Ancorar no <time datetime> é de propósito: é semântico e já vem em ISO com fuso — não
// depende das classes utilitárias do Tailwind, que mudam a cada build do portal, e evita
// reparsear data em português.
//
// O LOTE ENTRA NO TEXTO. Duas mensagens iguais no mesmo segundo, uma para o ITEM-01 e
// outra para o ITEM-02, são o caso NORMAL aqui (foi o que o portal devolveu em Cruz das
// Almas/BA). Sem o lote, o dedup por hash colapsaria as duas em uma e o fornecedor
// perderia que o fato aconteceu nos dois itens.

import { SIMULADO_FIXTURES, normalizarMensagem, withBackoff, abrirPagina, PortalRecusou } from './connector-base.mjs'
import { portalMeta } from './portais.mjs'

const META = portalMeta('licitanet')
const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Mesmo raciocínio do BLL/BNC: página pública custa segundos de navegador, e o Licitanet
// sozinho responde por ~3,1 mil contratações de saúde em 180 dias. O worker manda os
// processos ordenados por proximidade da sessão; o teto corta a cauda, e diz que cortou.
const TETO_PROCESSOS = 60

/** A URL é a sessão pública de um processo do Licitanet? */
export function urlDeSessao(url) {
  return /licitanet\.com\.br\/sessao\/\d+/i.test(String(url ?? ''))
}

/**
 * Extrai as mensagens do painel "Comunicação da sessão".
 * Devolve `null` quando o painel NÃO está na página — que é diferente de estar vazio, e
 * é essa diferença que separa "sem mensagens" de "não consegui ler".
 */
export async function extrairMensagensLicitanet(page) {
  return page.evaluate(() => {
    const painel = Array.from(document.querySelectorAll('*')).some(
      (e) => e.children.length === 0 && /comunica[çc][ãa]o da sess[ãa]o/i.test((e.textContent || '').trim()),
    )
    if (!painel) return null

    const out = []
    for (const header of document.querySelectorAll('header')) {
      const time = header.querySelector('time[datetime]')
      if (!time) continue
      const bloco = header.parentElement
      if (!bloco) continue

      const spans = Array.from(header.querySelectorAll('span'))
      const autor = (spans[0]?.textContent || '').trim() || null
      const loteEl = spans.find((s) => /mensagem do lote/i.test(s.getAttribute('aria-label') || ''))
      const lote = (loteEl?.textContent || '').trim() || null

      const corpo = Array.from(bloco.children)
        .filter((c) => c.tagName !== 'HEADER')
        .map((c) => (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
        .trim()
      if (!corpo) continue

      out.push({
        autor,
        lote,
        texto: lote ? `[${lote}] ${corpo}` : corpo,
        // ISO com fuso, vindo do próprio portal.
        horario: time.getAttribute('datetime'),
      })
    }
    return out
  })
}

/**
 * Abre a sessão pública de UM processo e devolve as mensagens.
 * @returns {Promise<{linhas: Array<object>} | {erro: string}>}
 */
async function lerSessao(page, url) {
  // `abrirPagina` lança PortalRecusou em 403/429/5xx. Deixar subir é de propósito:
  // recusa é sobre o PORTAL, não sobre este processo, e quem chama precisa parar.
  await abrirPagina(page, url, { timeout: 45000, tentativas: 2 })
  await page.waitForTimeout(6000) // o Vue monta a sessão

  // SEM ESTE SCROLL O CONECTOR LÊ ZERO E ACHA QUE LEU. O painel de mensagens só é
  // montado quando entra em tela; medido nas duas direções no mesmo processo.
  try {
    await page
      .getByText(/comunica(ç|c)(ã|a)o da sess(ã|a)o/i)
      .first()
      .scrollIntoViewIfNeeded({ timeout: 8000 })
  } catch {
    return { erro: 'o painel "Comunicação da sessão" não apareceu na página' }
  }
  await page.waitForTimeout(3000)

  const linhas = await extrairMensagensLicitanet(page)
  if (linhas === null) return { erro: 'o painel de mensagens sumiu antes da leitura' }
  return { linhas }
}

/**
 * RECUSA É FATO SOBRE O PORTAL, NÃO SOBRE O TENANT.
 *
 * O `break` no laço abaixo protege a passada de UM titular — mas o `run.mjs` chama este
 * `sync` uma vez POR TITULAR. Com 5 tenants monitorando o Licitanet, um 403 produzia 5
 * `chromium.launch()` (~12 s cada) e 5 batidas novas na mesma porta fechada, mais 5
 * linhas de `portal_indisponivel` gravadas como se fossem verificações independentes.
 * Se a regra do WAF for por taxa, é isso que renova o bloqueio.
 *
 * O flag vive no escopo do módulo. O processo do worker morre ao fim da passada, então
 * ele se limpa sozinho entre rodadas; `esquecerRecusa()` existe para os testes.
 */
let recusadoNestaRodada = null
export function esquecerRecusa() { recusadoNestaRodada = null }

export async function sync({ credencial, processos = [], simulado }) {
  if (simulado) {
    const mensagens = []
    const alvos = processos.length ? processos : [{ licitacaoId: 'SIMULADO-licitanet' }]
    for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
    return { status: 'ok', detalhe: `simulado (${META.nome})`, mensagens }
  }

  // Já recusou nesta rodada, para outro tenant? Então nem abrimos o navegador.
  if (recusadoNestaRodada) {
    return {
      status: 'portal_indisponivel',
      mensagens: [],
      detalhe: `o ${META.nome} já recusou a conexão (HTTP ${recusadoNestaRodada}) nesta rodada — não insisti`,
    }
  }

  const todos = processos.filter((p) => urlDeSessao(p?.urlPublica))
  const semUrl = processos.length - todos.length
  const alvos = todos.slice(0, TETO_PROCESSOS)
  const truncados = todos.length - alvos.length

  if (!alvos.length) {
    return {
      status: 'ok',
      mensagens: [],
      detalhe: `nenhum processo com sessão pública do ${META.nome} nesta passada${semUrl ? ` (${semUrl} sem link /sessao/)` : ''}`,
    }
  }

  let chromium
  try {
    ({ chromium } = await import('playwright'))
  } catch {
    return { status: 'falha', detalhe: 'Playwright não instalado (npx playwright install chromium)', mensagens: [] }
  }

  let browser
  const mensagens = []
  const falhas = []
  let comMensagem = 0
  let lidos = 0
  /** @type {PortalRecusou | null} */
  let recusa = null
  try {
    browser = await withBackoff(() => chromium.launch({ headless: true }))
    const context = await browser.newContext({ userAgent: UA_NAVEGADOR })
    const page = await context.newPage()

    for (const p of alvos) {
      try {
        const r = await lerSessao(page, p.urlPublica)
        if (r.erro) { falhas.push(`${p.licitacaoId}: ${r.erro}`); continue }
        lidos++
        if (r.linhas.length) comMensagem++
        for (const l of r.linhas) {
          mensagens.push(
            normalizarMensagem(
              { autor: l.autor, texto: l.texto, horarioOrigem: l.horario, lote: l.lote, fonte: 'comunicação da sessão' },
              p.licitacaoId,
            ),
          )
        }
      } catch (e) {
        // PARAR NA PRIMEIRA RECUSA. Quando o portal responde 403 ele está fechado
        // para nós inteiro, não para este processo: as outras 59 tentativas seriam
        // 59 páginas de erro — e, se a regra do WAF for por taxa, renovariam o
        // bloqueio em vez de esperá-lo passar.
        if (e instanceof PortalRecusou) { recusa = e; recusadoNestaRodada = e.status; break }
        falhas.push(`${p.licitacaoId}: ${String(e?.message ?? e).slice(0, 80)}`)
      }
    }
  } catch (e) {
    const msg = String(e?.message ?? e)
    try { if (browser) await browser.close() } catch { /* ignore */ }
    if (/timeout|net::|ECONN|ENOTFOUND|navigation/i.test(msg)) {
      return { status: 'portal_indisponivel', detalhe: msg.slice(0, 180), mensagens: [] }
    }
    return { status: 'falha', detalhe: msg.slice(0, 180), mensagens: [] }
  } finally {
    try { if (browser) await browser.close() } catch { /* ignore */ }
  }

  // O portal fechou a porta. Isso é `portal_indisponivel`, não `falha`: `falha` quer
  // dizer "o nosso conector quebrou" e manda consertar código que está certo.
  // As mensagens lidas ANTES da recusa vão junto — foram lidas de verdade —, mas o
  // status continua sendo de incerteza, porque o resto da passada não aconteceu.
  if (recusa) {
    const parcial = lidos ? `${lidos} de ${alvos.length} processo(s) lidos antes` : 'nenhuma página foi lida'
    return {
      status: 'portal_indisponivel',
      mensagens,
      detalhe: `o ${META.nome} recusou a conexão (HTTP ${recusa.status}) — ${parcial}; parei na 1ª recusa para não insistir contra o bloqueio`,
    }
  }

  if (falhas.length === alvos.length) {
    return {
      status: 'falha',
      mensagens: [],
      detalhe: `nenhuma das ${alvos.length} sessão(ões) do ${META.nome} pôde ser lida — ${falhas[0]}`,
    }
  }

  const partes = [`${mensagens.length} mensagem(ns) em ${comMensagem}/${alvos.length} processo(s)`]
  if (falhas.length) partes.push(`${falhas.length} sessão(ões) não lida(s)`)
  if (truncados) partes.push(`${truncados} além do teto de ${TETO_PROCESSOS} nesta passada`)
  // O painel entrega as mais recentes (o portal mostra "20+"), e é isso que interessa a
  // quem monitora de 2 em 2 horas — mas quem lê o detalhe tem de saber que é um recorte.
  partes.push('painel público (as mais recentes da sessão)')
  if (credencial?.storageState) partes.push('sessão salva ainda não usada por este portal')

  return { status: 'ok', mensagens, detalhe: partes.join(' · ') }
}
