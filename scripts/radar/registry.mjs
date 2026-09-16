// scripts/radar/registry.mjs — REGISTRO de conectores do worker (id → função sync).
// O worker (run.mjs) despacha por cred.conector_id. Compras.gov.br lê a área logada
// (sessão capturada); PCP, BLL e BNC leem a página PÚBLICA do processo, sem credencial.
// Licitações-e segue scaffold honesto até a etapa 2 (ver connector-scaffold.mjs).

import { sync as comprasgov } from './connector-comprasgov.mjs'
import { sync as licitacoesE } from './connector-licitacoes-e.mjs'
import { sync as bll } from './connector-bll.mjs'
import { sync as bnc } from './connector-bnc.mjs'
import { sync as licitanet } from './connector-licitanet.mjs'
import { sync as ammlicita } from './connector-ammlicita.mjs'
import { sync as pcp } from './connector-pcp.mjs'
// Compras RS e Pregão Banrisul: mesma aplicação, dois ids — um conector só, amarrado ao
// id para que o `detalhe` e a saúde na tela citem o portal certo.
import { syncEgovRs, syncBanrisul } from './connector-egovrs.mjs'
import { sync as comprasbr } from './connector-comprasbr.mjs'

export const CONECTORES = {
  comprasgov,
  'licitacoes-e': licitacoesE,
  bll,
  bnc,
  licitanet,
  ammlicita,
  pcp,
  egovrs: syncEgovRs,
  banrisul: syncBanrisul,
  comprasbr,
}

/** Função de sync de um conector, ou null se desconhecido. */
export function conectorSync(id) {
  return CONECTORES[id] ?? null
}
