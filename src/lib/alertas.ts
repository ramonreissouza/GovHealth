// src/lib/alertas.ts
// AlertaConfig = regra de monitoramento configurada pelo usuário (localStorage)
// AlertaNotificacao = notificação gerada ao fazer match com PNCP

const STORAGE_CONFIG = 'govhealth:alertas:configs'
const STORAGE_NOTIF  = 'govhealth:alertas:notifs'

export type AlertaCategoria = 'imagem' | 'uti' | 'laboratorio' | 'cirurgia' | 'oncologia' | 'outros'

export interface AlertaConfig {
  id: string
  nome: string
  termos: string[]
  ufs: string[]
  categorias: AlertaCategoria[]
  valorMin?: number
  valorMax?: number
  ativo: boolean
  emailHabilitado: boolean
  criadoEm: string
}

export interface AlertaNotificacao {
  id: string
  alertaId: string
  alertaNome: string
  titulo: string
  descricao: string
  urgencia: 'alta' | 'media' | 'normal'
  link?: string
  lida: boolean
  criadoEm: string
}

// ── AlertaConfig CRUD ──────────────────────────────────────────────────────────

export function getAlertaConfigs(): AlertaConfig[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONFIG) ?? '[]')
  } catch { return [] }
}

function saveAlertaConfigs(configs: AlertaConfig[]) {
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(configs))
}

export function createAlertaConfig(data: Omit<AlertaConfig, 'id' | 'criadoEm'>): AlertaConfig {
  const config: AlertaConfig = {
    ...data,
    id: crypto.randomUUID(),
    criadoEm: new Date().toISOString(),
  }
  saveAlertaConfigs([...getAlertaConfigs(), config])
  return config
}

export function updateAlertaConfig(id: string, patch: Partial<Omit<AlertaConfig, 'id' | 'criadoEm'>>): void {
  saveAlertaConfigs(
    getAlertaConfigs().map((c) => (c.id === id ? { ...c, ...patch } : c))
  )
}

export function deleteAlertaConfig(id: string): void {
  saveAlertaConfigs(getAlertaConfigs().filter((c) => c.id !== id))
  // Remove orphan notifications
  saveNotificacoes(getNotificacoes().filter((n) => n.alertaId !== id))
}

// ── Notificações ──────────────────────────────────────────────────────────────

export function getNotificacoes(): AlertaNotificacao[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_NOTIF) ?? '[]')
  } catch { return [] }
}

function saveNotificacoes(notifs: AlertaNotificacao[]) {
  // keep latest 200
  localStorage.setItem(STORAGE_NOTIF, JSON.stringify(notifs.slice(0, 200)))
}

export function addNotificacoes(notifs: AlertaNotificacao[]) {
  const existing = getNotificacoes()
  const existingIds = new Set(existing.map((n) => n.id))
  const novas = notifs.filter((n) => !existingIds.has(n.id))
  if (novas.length > 0) {
    saveNotificacoes([...novas, ...existing])
  }
}

export function marcarLida(id: string) {
  saveNotificacoes(getNotificacoes().map((n) => (n.id === id ? { ...n, lida: true } : n)))
}

export function marcarTodasLidas() {
  saveNotificacoes(getNotificacoes().map((n) => ({ ...n, lida: true })))
}

export function contarNaoLidas(): number {
  return getNotificacoes().filter((n) => !n.lida).length
}

export function limparNotificacoes() {
  saveNotificacoes([])
}

// ── Match engine ──────────────────────────────────────────────────────────────
// Verifica se uma lista de items (ex: alertas da API) bate em um AlertaConfig

export interface ItemParaMatch {
  id: string
  titulo: string
  descricao: string
  uf?: string
  categoria?: string
  valor?: number
  link?: string
  urgencia?: 'alta' | 'media' | 'normal'
}

export function matchItem(item: ItemParaMatch, config: AlertaConfig): boolean {
  if (!config.ativo) return false
  const text = `${item.titulo} ${item.descricao}`.toLowerCase()

  // termos
  if (config.termos.length > 0 && !config.termos.some((t) => text.includes(t.toLowerCase()))) return false
  // ufs
  if (config.ufs.length > 0 && item.uf && !config.ufs.includes(item.uf)) return false
  // categorias
  if (config.categorias.length > 0 && item.categoria && !config.categorias.includes(item.categoria as AlertaCategoria)) return false
  // valor
  if (config.valorMin != null && (item.valor ?? 0) < config.valorMin) return false
  if (config.valorMax != null && (item.valor ?? 0) > config.valorMax) return false

  return true
}

export function gerarNotificacoesDosMatches(
  items: ItemParaMatch[],
  configs: AlertaConfig[]
): AlertaNotificacao[] {
  const notifs: AlertaNotificacao[] = []
  for (const config of configs) {
    for (const item of items) {
      if (matchItem(item, config)) {
        notifs.push({
          id: `${config.id}:${item.id}`,
          alertaId: config.id,
          alertaNome: config.nome,
          titulo: item.titulo,
          descricao: item.descricao,
          urgencia: item.urgencia ?? 'media',
          link: item.link,
          lida: false,
          criadoEm: new Date().toISOString(),
        })
      }
    }
  }
  return notifs
}
