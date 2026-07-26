// scripts/radar/registry.mjs — REGISTRO de conectores do worker (id → função sync).
// O worker (run.mjs) despacha por cred.conector_id. Compras.gov.br é o conector real;
// os demais são scaffolds honestos até a etapa 2 (ver connector-scaffold.mjs).

import { sync as comprasgov } from './connector-comprasgov.mjs'
import { sync as licitacoesE } from './connector-licitacoes-e.mjs'
import { sync as bll } from './connector-bll.mjs'
import { sync as pcp } from './connector-pcp.mjs'

export const CONECTORES = {
  comprasgov,
  'licitacoes-e': licitacoesE,
  bll,
  pcp,
}

/** Função de sync de um conector, ou null se desconhecido. */
export function conectorSync(id) {
  return CONECTORES[id] ?? null
}
