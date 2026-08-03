// src/lib/radar/config.ts — CONFIGURAÇÕES do Monitorar Chat (notificações).
// Módulo PURO: tipos + defaults + saneamento, usados no client (tela de
// configurações) e no server (API + cron de alerta). As palavras-chave em si
// vivem em `radar_regras` (tipo 'keyword'); aqui ficam só as preferências de
// notificação, gravadas em user_data sob a chave 'radar_config'.

export const CHAVE_CONFIG = 'radar_config'

/** De quais mensagens o usuário quer ser avisado. */
export type EscopoNotificacao = 'todas' | 'palavra_chave'

export interface ConfigRadar {
  /** Interruptor mestre: false = nenhum alerta sai (a captura continua). */
  notificar: boolean
  email: boolean
  avisoSonoro: boolean
  push: boolean
  escopo: EscopoNotificacao
}

export const CONFIG_PADRAO: ConfigRadar = {
  notificar: true,
  email: true,
  avisoSonoro: false,
  push: false,
  escopo: 'todas',
}

/**
 * Palavras-chave que o sistema SUGERE quando o usuário ainda não configurou nada
 * — os termos que mais aparecem no chat de um pregão e mudam o que o fornecedor
 * precisa fazer. Espelha os padrões built-in de lib/radar/regras.
 */
export const CHAVES_SUGERIDAS = [
  'convocação', 'diligência', 'habilita', 'inabilita', 'recurso',
  'contrarrazão', 'proposta ajustada', 'negociação', 'prazo', 'anexo', 'documento',
]

/** Aceita um objeto vindo do banco/cliente e devolve uma config completa e válida. */
export function sanearConfig(bruto: unknown): ConfigRadar {
  const o = (bruto ?? {}) as Partial<Record<keyof ConfigRadar, unknown>>
  const bool = (v: unknown, padrao: boolean) => (typeof v === 'boolean' ? v : padrao)
  return {
    notificar: bool(o.notificar, CONFIG_PADRAO.notificar),
    email: bool(o.email, CONFIG_PADRAO.email),
    avisoSonoro: bool(o.avisoSonoro, CONFIG_PADRAO.avisoSonoro),
    push: bool(o.push, CONFIG_PADRAO.push),
    escopo: o.escopo === 'palavra_chave' ? 'palavra_chave' : 'todas',
  }
}
