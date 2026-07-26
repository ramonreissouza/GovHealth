// scripts/radar/connector-bll.mjs — conector do BLL (Bolsa de Licitações e Leilões).
// SCAFFOLD (etapa 2): framework pronto; login/seletores de chat a calibrar.

import { criarConectorScaffold } from './connector-scaffold.mjs'

export const sync = criarConectorScaffold({
  id: 'bll',
  nome: 'BLL — Bolsa de Licitações e Leilões',
  loginUrl: 'https://bll.org.br/',
})
