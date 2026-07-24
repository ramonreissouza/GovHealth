// src/lib/radar/types.ts — tipos do módulo Radar (monitoramento de chat de licitações).
// Módulo PURO (sem DB) — pode ser importado no client e no server. Espelha db/schema-radar.sql.

export type StatusSaude =
  | 'ok'
  | 'sessao_expirada'
  | 'portal_indisponivel'
  | 'falha'
  | 'captcha_2fa'
  | 'nunca_verificado'

export type Prioridade = 'alta' | 'normal' | 'baixa'

export type CategoriaRegra =
  | 'convocacao'
  | 'negociacao'
  | 'proposta_ajustada'
  | 'habilitacao'
  | 'diligencia'
  | 'recurso'
  | 'prazo'
  | 'cnpj'
  | 'keyword'
  | 'qualquer'

export interface RegraRadar {
  id: string
  titular_id: string | null
  user_id: string | null
  tipo: CategoriaRegra
  padrao: string | null
  prioridade: Prioridade
  ativo: boolean
}

export interface AnexoMensagem {
  nome: string
  url?: string
}

export interface MensagemRadar {
  id: number
  processo_id: string
  conector_id: string
  cnpj: string
  licitacao_id: string
  autor: string | null
  texto: string
  anexos: AnexoMensagem[]
  horario_origem: string | null
  capturado_em: string
  categorias: string[]
  prioridade: Prioridade
  lida: boolean
  lida_por: string | null
  lida_em: string | null
  // desnormalizados p/ a inbox
  titulo?: string | null
  link_portal?: string | null
}

export interface ProcessoMonitorado {
  id: string
  conector_id: string
  cnpj: string
  licitacao_id: string
  titulo: string | null
  uf: string | null
  valor: number | null
  responsavel: string | null
  prioridade: Prioridade
  status: 'ativo' | 'encerrado' | 'pausado'
  origem: 'auto' | 'manual'
  mutado: boolean
  motivo_match: Record<string, unknown>
  link_portal: string | null
}

export interface SaudeConector {
  credencial_id: string
  conector_id: string
  cnpj: string
  status: StatusSaude
  verificado_em: string | null
  tentado_em: string | null
  detalhe: string | null
}
