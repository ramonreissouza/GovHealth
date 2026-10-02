// src/lib/radar/saude.ts — helpers puros para o REQUISITO 4.2 (nunca dar falsa
// sensação de segurança). "Nenhuma mensagem nova" só pode ser afirmado quando o
// conector foi verificado com sucesso há pouco. Qualquer outro estado é INCERTEZA.

import type { StatusSaude } from './types'

// Forma mínima lida pelos helpers de UI (payload da API vem em camelCase).
export interface SaudeLike {
  status: StatusSaude
  verificadoEm: string | null
  /** null no monitor PÚBLICO (portal lido sem login): não há conta do cliente ali. */
  credencialId?: string | null
}

/** Os campos de diagnóstico de operação que só o administrador recebe. */
const CAMPOS_DIAGNOSTICO = ['detalhe', 'duracao_ms', 'duracaoMs'] as const

/**
 * Tira o diagnóstico de um item de saúde (ou de conexão) para quem não é o administrador.
 * É a única regra para TODAS as rotas que expõem saúde de conector — a inbox, a lista de
 * conectores e a de credenciais. Revisão da #52: aplicar só na inbox deixava o mesmo
 * texto a um GET de distância. Devolve cópia; não muda o original.
 */
export function semDiagnostico<T extends object>(item: T, podeVer: boolean): T {
  if (podeVer) return item
  const copia = { ...item } as Record<string, unknown>
  for (const campo of CAMPOS_DIAGNOSTICO) if (campo in copia) copia[campo] = null
  return copia as T
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
  nao_monitorado:      { cor: 'cinza',    titulo: 'Sem leitura automática — chat oficial abre no pregão', confiavel: false },
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
 * JANELA DE FRESCOR — por que 90 min e não 30 (medido em 16/09/2026).
 *
 * Eram 30, escolhidos no olho. Só que o worker não revisita cada portal de 30 em 30
 * minutos: ele cicla entre os portais, e o intervalo real entre duas passadas NO MESMO
 * conector (192 intervalos, 14 dias, tirado de radar_mensagens.capturado_em) tem
 * mediana de 19 a 85 min conforme o portal. Com a régua em 30, **39% das passadas
 * normais** chegavam atrasadas — e a tela pintava de âmbar quatro conectores que
 * estavam funcionando, empurrando a conversa para fora da primeira tela.
 *
 * Alarme que dispara em 39% do tempo normal não é alarme, é ruído — e ruído treina o
 * leitor a ignorar o âmbar, que é exatamente o contrário do requisito 4.2.
 */
export const JANELA_FRESCO_MIN = 90

/**
 * A partir daqui o silêncio deixa de ser cadência e vira sintoma: o worker roda no PC
 * do dono e às vezes para. 6 h cobre a cauda normal (10% dos intervalos diurnos
 * passam disso, quase todos por máquina desligada) sem calar um worker morto.
 */
export const JANELA_PARADO_MIN = 6 * 60

/**
 * Um conector é "confiável agora" se está OK e foi verificado dentro da janela.
 * Fora disso, a UI não pode afirmar "sem mensagens novas" — só pode dizer até quando
 * olhou. Continua sendo o guarda do requisito 4.2; o que mudou foi o tamanho da janela.
 */
export function confiavelAgora(s: SaudeLike, agoraMs: number, janelaMin = JANELA_FRESCO_MIN): boolean {
  if (s.status !== 'ok' || !s.verificadoEm) return false
  return agoraMs - new Date(s.verificadoEm).getTime() <= janelaMin * 60000
}

/**
 * QUEBRADO ≠ DESATUALIZADO. Esta é a distinção que a tela não fazia.
 *
 * `sessao_expirada` quer dizer "tentei e a porta estava fechada" — alguém precisa
 * reconectar, e isso merece ocupar espaço. `ok` de 40 minutos atrás quer dizer "a
 * última vez que olhei estava tudo bem, e ainda não voltei" — é informação, não
 * chamado. Dar a mesma moldura aos dois foi o que encheu a tela de laranja.
 */
export function quebrado(s: SaudeLike): boolean {
  return s.status === 'sessao_expirada' || s.status === 'captcha_2fa'
    || s.status === 'portal_indisponivel' || s.status === 'falha'
}

/** OK, mas calado tempo demais para continuar sendo só cadência. */
export function parado(s: SaudeLike, agoraMs: number, janelaMin = JANELA_PARADO_MIN): boolean {
  if (quebrado(s)) return false
  if (!s.verificadoEm) return false
  return agoraMs - new Date(s.verificadoEm).getTime() > janelaMin * 60000
}

/** O que realmente pede ação de alguém: quebrado, ou mudo há horas. */
export function precisaAtencao(s: SaudeLike, agoraMs: number): boolean {
  return quebrado(s) || parado(s, agoraMs)
}

/**
 * A conta do cliente no portal caiu: só ele resolve, reconectando.
 *
 * `captcha_2fa` só conta quando HÁ conta (credencial): o monitor público do Compras.gov.br
 * também cai em CAPTCHA, e ali não existe conta nenhuma para reconectar. Mandar o cliente
 * "reconectar em Configurações" seria pedir uma ação impossível (revisão da #52). O
 * CAPTCHA público segue pela régua do atraso, como qualquer portal que não deixou ler.
 */
export function contaExpirada(s: SaudeLike): boolean {
  if (s.status === 'sessao_expirada') return true
  return s.status === 'captcha_2fa' && !!s.credencialId
}

/**
 * O que o CLIENTE precisa saber de um portal (02/10/2026). `precisaAtencao` é a régua do
 * administrador: acende na primeira tentativa que falha, porque é quem conserta. Para o
 * cliente, uma passada que falhou 18 min depois de uma que deu certo não muda nada (a
 * próxima tenta de novo), e avisar disso só ensina a ignorar o aviso. O que muda para
 * ele é o portal ficar SEM LEITURA BOA há horas, ou nunca ter sido lido apesar de
 * tentado — aí as mensagens novas de fato não estão chegando.
 */
export function atrasadoParaCliente(s: SaudeLike, agoraMs: number, janelaMin = JANELA_PARADO_MIN): boolean {
  if (contaExpirada(s) || s.status === 'nao_monitorado' || s.status === 'nunca_verificado') return false
  if (!s.verificadoEm) return s.status === 'falha' || s.status === 'portal_indisponivel'
  return agoraMs - new Date(s.verificadoEm).getTime() > janelaMin * 60000
}

/**
 * Conectores que pedem atenção — é o que o banner de incerteza deve contar.
 * Antes contava todo mundo fora da janela de frescor, e por isso anunciava "4
 * conectores" num dia em que só um estava de fato quebrado.
 */
export function comProblema<T extends SaudeLike>(saude: T[], agoraMs: number): T[] {
  return saude.filter((s) => precisaAtencao(s, agoraMs))
}
