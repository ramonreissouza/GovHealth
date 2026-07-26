// scripts/radar/connector-pcp.mjs — conector do Portal de Compras Públicas.
// SCAFFOLD (etapa 2): framework pronto; login/seletores de chat a calibrar.

import { criarConectorScaffold } from './connector-scaffold.mjs'

export const sync = criarConectorScaffold({
  id: 'pcp',
  nome: 'Portal de Compras Públicas',
  loginUrl: 'https://www.portaldecompraspublicas.com.br/',
})
