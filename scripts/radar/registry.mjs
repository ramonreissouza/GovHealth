// scripts/radar/registry.mjs — REGISTRO de conectores do worker (id → função sync).
// O worker (run.mjs) despacha por cred.conector_id. Compras.gov.br lê a área logada
// (sessão capturada); PCP, BLL e BNC leem a página PÚBLICA do processo, sem credencial.
// Licitações-e segue scaffold honesto até a etapa 2 (ver connector-scaffold.mjs).

import { sync as comprasgov } from './connector-comprasgov.mjs'
import { sync as licitacoesE } from './connector-licitacoes-e.mjs'
import { sync as bll } from './connector-bll.mjs'
import { sync as bnc } from './connector-bnc.mjs'
import { sync as pcp } from './connector-pcp.mjs'

export const CONECTORES = {
  comprasgov,
  'licitacoes-e': licitacoesE,
  bll,
  bnc,
  pcp,
}

/** Função de sync de um conector, ou null se desconhecido. */
export function conectorSync(id) {
  return CONECTORES[id] ?? null
}
