// scripts/radar/connector-scaffold.mjs — fábrica de conector-scaffold (ETAPA 2).
// Portais além do Compras.gov.br já têm modelo de dados, seleção por portal e
// registro no worker prontos. A captura REAL do chat (login + seletores de DOM)
// é calibrada por portal na etapa 2 — até lá o conector é HONESTO: exercita todo
// o pipeline em --simulado e, em modo real, devolve status claro (nunca finge
// "sem novidades"). Use connector-comprasgov.mjs como referência ao implementar.

import { SIMULADO_FIXTURES, normalizarMensagem } from './connector-base.mjs'

/**
 * @param {{ id: string, nome: string, loginUrl: string }} meta
 * @returns {(ctx: { credencial: object, processos: Array<{licitacaoId: string}>, simulado?: boolean }) => Promise<object>}
 */
export function criarConectorScaffold({ id, nome, loginUrl }) {
  return async function sync({ credencial, processos = [], simulado }) {
    // Simulado: pipeline completo (normalização/dedup/classificação) sem browser.
    if (simulado) {
      const mensagens = []
      const alvos = processos.length ? processos : [{ licitacaoId: `SIMULADO-${id}` }]
      for (const p of alvos) for (const f of SIMULADO_FIXTURES) mensagens.push(normalizarMensagem(f, p.licitacaoId))
      return { status: 'ok', detalhe: `simulado (${nome})`, mensagens }
    }
    // Sem sessão capturada não há como ler o chat autenticado.
    if (!credencial?.storageState) {
      return { status: 'sessao_expirada', detalhe: `Sessão do ${nome} não capturada — conector em calibração (etapa 2)`, mensagens: [], loginUrl }
    }
    // ETAPA 2: com a sessão, abrir a área de acompanhamento do portal e extrair o
    // chat de cada processo (seletores de DOM específicos do ${nome} entram aqui).
    return { status: 'falha', detalhe: `Captura de chat do ${nome} pendente de calibração (etapa 2)`, mensagens: [] }
  }
}
