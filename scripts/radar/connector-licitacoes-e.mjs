// scripts/radar/connector-licitacoes-e.mjs — conector do Licitações-e (Banco do Brasil).
// SCAFFOLD (etapa 2): framework pronto; login/seletores de chat a calibrar.
// Já temos infra de coleta do portal em scripts/licite — reusar ao implementar a captura.

import { criarConectorScaffold } from './connector-scaffold.mjs'

export const sync = criarConectorScaffold({
  id: 'licitacoes-e',
  nome: 'Licitações-e (Banco do Brasil)',
  loginUrl: 'https://www.licitacoes-e.com.br/aop/index.jsp',
})
