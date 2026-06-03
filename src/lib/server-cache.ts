// src/lib/server-cache.ts
// Cache TTL in-memory para rotas de API server-side.
// Vive na mem�ria do processo Node � sobrevive entre requests do mesmo processo
// (hot-reload no dev limpa, o que � aceit�vel).
//
// LIMITA��O DE ESCALABILIDADE (intencional/documentada): este cache � por-inst�ncia.
// Em deploy serverless ou horizontalmente escalado, cada inst�ncia tem o seu pr�prio
// cache (n�o compartilhado). Para produ��o multi-inst�ncia, trocar a implementa��o
// por Redis/Upstash mantendo esta MESMA interface (getCached/setCached/TTL).
//
// Prote��o de mem�ria: limite de entradas com evic��o LRU + expira��o pregui�osa,
// evitando crescimento ilimitado quando h� muitas chaves distintas (ex.: buscas
// por termo/UF/categoria), que antes podia vazar mem�ria ao longo do tempo.

const MAX_ENTRIES = 500

interface Entry {
  data: unknown
  expires: number
}

// Map mant�m ordem de inser��o ? usamos isso para LRU simples (re-inser��o move ao fim).
const store = new Map<string, Entry>()

export function getCached<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    store.delete(key)
    return null
  }
  // LRU touch: move a chave para o fim (mais recentemente usada).
  store.delete(key)
  store.set(key, entry)
  return entry.data as T
}

export function setCached<T>(key: string, data: T, ttlMs: number): T {
  // Atualiza posi��o se j� existe.
  if (store.has(key)) store.delete(key)
  store.set(key, { data, expires: Date.now() + ttlMs })

  // Evic��o: enquanto exceder o limite, remove a entrada menos recentemente usada
  // (a primeira do Map). Limpa expiradas oportunisticamente no caminho.
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (oldestKey === undefined) break
    store.delete(oldestKey)
  }
  return data
}

/** Remove uma chave (ou todas) � �til para invalida��o manual. */
export function clearCached(key?: string): void {
  if (key === undefined) store.clear()
  else store.delete(key)
}

export const TTL = {
  SHORT:  15 * 60 * 1000,   // 15 min � opportunities / licitacoes
  MEDIUM: 30 * 60 * 1000,   // 30 min � vencedores
  LONG:   24 * 60 * 60 * 1000, // 24 h  � itens per contract (static)
} as const
