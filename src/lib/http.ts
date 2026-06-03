// src/lib/http.ts
// Utilidades HTTP compartilhadas. `withTimeout` estava duplicado em
// pncp/comprasgov/dou/cnes — agora há uma única implementação.

/**
 * Race entre a promise e um timeout. Compatível com o fetch aprimorado do Next.
 * Observação: não cancela a request subjacente — apenas rejeita a espera.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'request'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms)
    ),
  ])
}

/** Pausa por `ms` milissegundos (throttling cooperativo). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
