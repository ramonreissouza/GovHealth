// src/lib/radar/conectores.ts — CATÁLOGO de portais do Radar (fonte única para a UI).
// Módulo PURO (sem DB): usado no cliente (picker de portal, rótulos de saúde) e
// espelhado no seed do banco (db/schema-radar.sql) + no worker (scripts/radar).
//
// `disponivel` = o fluxo de conexão (captura de sessão) já funciona ponta-a-ponta.
// Hoje só o Compras.gov.br está disponível; BLL, PCP e Licitações-e têm o framework
// pronto (modelo de dados, seleção por portal, registro no worker) e entram como
// ETAPA 2 quando os seletores de login/chat de cada portal forem calibrados.

export interface Conector {
  id: string
  nome: string
  descricao: string
  disponivel: boolean
}

export const CONECTORES: Conector[] = [
  {
    id: 'comprasgov',
    nome: 'Compras.gov.br',
    descricao: 'Portal federal (ex-ComprasNet). Login via gov.br.',
    disponivel: true,
  },
  {
    id: 'licitacoes-e',
    nome: 'Licitações-e (Banco do Brasil)',
    descricao: 'Pregões conduzidos no portal do BB. Em calibração (etapa 2).',
    disponivel: false,
  },
  {
    id: 'bll',
    nome: 'BLL — Bolsa de Licitações e Leilões',
    descricao: 'Portal privado usado por muitos municípios. Em calibração (etapa 2).',
    disponivel: false,
  },
  {
    id: 'pcp',
    nome: 'Portal de Compras Públicas',
    descricao: 'Prefeituras, consórcios e órgãos estaduais. Em calibração (etapa 2).',
    disponivel: false,
  },
]

const POR_ID = new Map(CONECTORES.map((c) => [c.id, c]))

/** Nome amigável de um conector pelo id (fallback: o próprio id). */
export function nomeConector(id: string): string {
  return POR_ID.get(id)?.nome ?? id
}

export function conectorDisponivel(id: string): boolean {
  return POR_ID.get(id)?.disponivel ?? false
}
