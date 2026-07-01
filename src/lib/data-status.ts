// src/lib/data-status.ts
// Fonte ÚNICA da proveniência/atualidade do dado exibido na tela (item 9 — confiança).
//
// Problema que resolve: o selo "Atualizado há X" do Topbar era DECORATIVO — contava
// o tempo desde o render da página, não desde a coleta real do dado. Aqui guardamos o
// timestamp e a fonte que as APIs realmente devolvem (`atualizadoEm` / `fonte`), para
// que o selo reflita a verdade. Se nada foi publicado, o selo NÃO inventa um horário.
//
// Observable minimalista (mesmo padrão leve usado no resto do app, sem dependências):
// componentes client chamam `publishDataStatus(resp)` ao receber a resposta da API, e o
// Topbar assina via `subscribeDataStatus`.

export interface DataStatus {
  /** ISO string do momento em que o dado foi coletado/cacheado no servidor. */
  atualizadoEm: string
  /** Rótulo da origem, ex.: "PNCP (tempo real)". */
  fonte: string
}

let current: DataStatus | null = null
const listeners = new Set<(s: DataStatus | null) => void>()

/** Publica o status a partir de uma resposta de API que contenha `atualizadoEm`/`fonte`. */
export function publishDataStatus(resp: { atualizadoEm?: unknown; fonte?: unknown } | null | undefined): void {
  if (!resp || typeof resp.atualizadoEm !== 'string') return
  current = {
    atualizadoEm: resp.atualizadoEm,
    fonte: typeof resp.fonte === 'string' && resp.fonte ? resp.fonte : 'PNCP',
  }
  for (const fn of listeners) fn(current)
}

export function getDataStatus(): DataStatus | null {
  return current
}

export function subscribeDataStatus(fn: (s: DataStatus | null) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** "há 2h", "há 5 min", "agora" — a partir de um ISO real de coleta. */
export function tempoDesde(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMin = Math.floor((Date.now() - then) / 60_000)
  if (diffMin < 1) return 'agora'
  if (diffMin === 1) return 'há 1 min'
  if (diffMin < 60) return `há ${diffMin} min`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}
