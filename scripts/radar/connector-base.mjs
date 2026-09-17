// scripts/radar/connector-base.mjs — contrato do adaptador de portal + utilidades.
// Cada portal implementa `sync({ credencial, processos, simulado })` e devolve:
//   { status, detalhe, mensagens: [{ licitacaoId, autor, texto, horarioOrigem, anexos, raw }], storageState? }
// status ∈ ok | sessao_expirada | portal_indisponivel | falha | captcha_2fa
// REGRA DE OURO (requisito 4.2): só devolver 'ok' quando a verificação REALMENTE
// ocorreu. Falta de mensagens com status 'ok' = "sem novidades"; qualquer outra
// coisa NÃO pode ser lida como "sem novidades".

/** Retry com backoff exponencial (2s, 4s, 6s… até ~20s), igual ao ETL PNCP. */
export async function withBackoff(fn, tries = 4) {
  let ultimoErro
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      ultimoErro = e
      const espera = Math.min(2000 * (i + 1), 20000)
      await new Promise((r) => setTimeout(r, espera))
    }
  }
  throw ultimoErro
}

/** Fixtures para --simulado (exercita todo o pipeline sem browser/rede). */
export const SIMULADO_FIXTURES = [
  { autor: 'Pregoeiro', texto: 'Convocamos a empresa para envio da proposta ajustada e documentação de habilitação até às 15h de hoje.', horarioOrigem: null },
  { autor: 'Pregoeiro', texto: 'Aberta fase de negociação: solicitamos redução do valor do item 3.', horarioOrigem: null },
  { autor: 'Sistema', texto: 'Prazo para recurso encerra amanhã às 18h.', horarioOrigem: null },
  { autor: 'Pregoeiro', texto: 'Diligência: apresentar atestado de capacidade técnica em 24h.', horarioOrigem: null },
]

/** Normaliza uma mensagem crua para o modelo único. */
export function normalizarMensagem(raw, licitacaoId) {
  return {
    licitacaoId,
    autor: raw.autor ?? null,
    texto: String(raw.texto ?? '').trim(),
    horarioOrigem: raw.horarioOrigem ?? null,
    anexos: Array.isArray(raw.anexos) ? raw.anexos : [],
    raw,
  }
}

/**
 * Converte horário BR ("10/07/2026 18:50:39" ou "10/07/2026 18:50") em ISO com o
 * fuso de Brasília (-03:00). O banco grava em TIMESTAMPTZ — sem isso, "23/08/2024"
 * seria lido como mês 23 e QUEBRARIA o INSERT. Sem casar → null (seguro).
 *
 * Vive aqui, e não em um conector, porque TODO portal brasileiro escreve a data
 * assim: nasceu no PCP e o BLL/BNC usa exatamente o mesmo formato.
 */
export function horarioBrParaISO(s) {
  const m = String(s ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, d, mo, y, h, mi, se] = m
  const p = (n) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se || '00')}-03:00`
}

/**
 * RECUSA DO PORTAL — o buraco que fez o Licitanet ser diagnosticado errado (16/09/2026).
 *
 * `page.goto()` do Playwright NÃO lança em 403. Ele resolve normalmente, com uma
 * página de erro no lugar do portal. Nenhum conector daqui olhava o status, então
 * todos raciocinavam só sobre o DOM — e o DOM de um 403 não tem o painel que se
 * procura. Resultado no Licitanet:
 *
 *   detalhe gravado:  o painel "Comunicação da sessão" não apareceu na página
 *   o que houve:      HTTP 403 no domínio inteiro, home e robots.txt inclusive
 *
 * A mensagem manda quem lê caçar um seletor que não tem nada de errado. É o mesmo
 * pecado do requisito 4.2, do outro lado: não dar falsa sensação de segurança, mas
 * também não dar falso diagnóstico.
 */
export class PortalRecusou extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`)
    this.name = 'PortalRecusou'
    this.status = status
    this.url = url
  }
}

/**
 * O portal recusou a conexão? Note que 404 NÃO entra: página que não existe é fato
 * sobre AQUELE processo (edital removido, id errado) e o conector segue para o
 * próximo. Recusa é sobre o PORTAL, e nesse caso insistir só piora — se a regra do
 * WAF for por taxa, cada tentativa a mais renova o bloqueio.
 */
export function ehRecusaDoPortal(status) {
  return status === 401 || status === 403 || status === 407 || status === 429 || status >= 500
}

/**
 * Abre uma página e EXIGE que o portal tenha respondido de verdade.
 * Lança `PortalRecusou` quando não respondeu; devolve o status quando respondeu.
 *
 * `goto` devolve null em navegação no mesmo documento (âncora, history.pushState).
 * Null não é recusa: é ausência de resposta nova, e a página que já está aberta
 * continua valendo.
 */
export async function abrirPagina(page, url, { timeout = 45000, tentativas = 2, waitUntil = 'domcontentloaded' } = {}) {
  const resposta = await withBackoff(() => page.goto(url, { waitUntil, timeout }), tentativas)
  const status = resposta?.status() ?? null
  if (status !== null && ehRecusaDoPortal(status)) throw new PortalRecusou(status, url)
  return status
}
