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
