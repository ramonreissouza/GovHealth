// src/lib/radar/saude.ts — helpers puros para o REQUISITO 4.2 (nunca dar falsa
// sensação de segurança). "Nenhuma mensagem nova" só pode ser afirmado quando o
// conector foi verificado com sucesso há pouco. Qualquer outro estado é INCERTEZA.

import type { StatusSaude } from './types'

// Forma mínima lida pelos helpers de UI (payload da API vem em camelCase).
export interface SaudeLike {
  status: StatusSaude
  verificadoEm: string | null
}

export interface RotuloSaude {
  cor: 'verde' | 'amarelo' | 'vermelho' | 'cinza'
  titulo: string
  /** true só quando é seguro dizer "sem novidades". */
  confiavel: boolean
}

const META: Record<StatusSaude, Omit<RotuloSaude, never>> = {
  ok:                  { cor: 'verde',    titulo: 'Verificado',                          confiavel: true },
  sessao_expirada:     { cor: 'amarelo',  titulo: 'Sessão expirada — reconecte',         confiavel: false },
  captcha_2fa:         { cor: 'amarelo',  titulo: 'Verificação pendente (2FA/CAPTCHA)',   confiavel: false },
  portal_indisponivel: { cor: 'amarelo',  titulo: 'Portal indisponível na última tentativa', confiavel: false },
  falha:               { cor: 'vermelho', titulo: 'Falha no conector',                   confiavel: false },
  nunca_verificado:    { cor: 'cinza',    titulo: 'Aguardando primeira verificação',     confiavel: false },
}

export function rotuloSaude(status: StatusSaude): RotuloSaude {
  return META[status] ?? META.nunca_verificado
}

/** "há 3 min", "há 2 h", "há 1 d". Sem dependência de Date.now no módulo puro: recebe agora. */
export function tempoDesde(iso: string | null | undefined, agoraMs: number): string {
  if (!iso) return '—'
  const diff = Math.max(0, agoraMs - new Date(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/**
 * Um conector é "confiável agora" se está OK e foi verificado dentro da janela
 * (default 30 min). Fora disso, a UI não pode afirmar "sem mensagens novas".
 */
export function confiavelAgora(s: SaudeLike, agoraMs: number, janelaMin = 30): boolean {
  if (s.status !== 'ok' || !s.verificadoEm) return false
  return agoraMs - new Date(s.verificadoEm).getTime() <= janelaMin * 60000
}

/** Quantos conectores estão com problema (não-confiáveis) — para o banner de incerteza. */
export function comProblema<T extends SaudeLike>(saude: T[], agoraMs: number): T[] {
  return saude.filter((s) => !confiavelAgora(s, agoraMs))
}
