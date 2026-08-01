// src/lib/radar/conectores.ts — CATÁLOGO de portais do Radar (fonte única para a UI).
// Módulo PURO (sem DB): usado no cliente (picker de portal, rótulos de saúde) e
// espelhado no seed do banco (db/schema-radar.sql) + no worker (scripts/radar).
//
// `disponivel` = dá para monitorar o chat ponta-a-ponta.
// `modoPublico` = o portal publica o andamento do processo SEM login (o Radar lê a
//   página pública; não pede credencial). É o caso do PCP: monitoramos o andamento
//   (convocação, habilitação, recurso, prazo, homologação) de graça; a sessão do
//   próprio cliente só é necessária para a sala AO VIVO (lances em tempo real).
// Compras.gov.br usa captura de sessão (login gov.br). BLL/Licitações-e seguem
// em ETAPA 2 (login/seletores a calibrar).

export interface Conector {
  id: string
  nome: string
  descricao: string
  disponivel: boolean
  /** Monitora pela página pública, sem exigir login. */
  modoPublico?: boolean
}

export const CONECTORES: Conector[] = [
  {
    id: 'comprasgov',
    nome: 'Compras.gov.br',
    descricao: 'Portal federal (ex-ComprasNet). Login via gov.br.',
    disponivel: true,
  },
  {
    id: 'pcp',
    nome: 'Portal de Compras Públicas',
    descricao: 'Prefeituras, consórcios e órgãos estaduais. Monitoramento público — sem login.',
    disponivel: true,
    modoPublico: true,
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
]

const POR_ID = new Map(CONECTORES.map((c) => [c.id, c]))

/** Nome amigável de um conector pelo id (fallback: o próprio id). */
export function nomeConector(id: string): string {
  return POR_ID.get(id)?.nome ?? id
}

export function conectorDisponivel(id: string): boolean {
  return POR_ID.get(id)?.disponivel ?? false
}

/** Portal monitorado pela página pública (sem login/credencial). */
export function conectorPublico(id: string): boolean {
  return POR_ID.get(id)?.modoPublico ?? false
}
