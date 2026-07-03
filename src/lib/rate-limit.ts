// src/lib/rate-limit.ts — rate limiting simples (janela fixa) em memória.
// Usado no middleware (item 6 e 9 do checklist de segurança) contra brute force de
// login e abuso/custo das APIs de dados.
//
// ⚠️ LIMITAÇÃO (honesta): o contador vive na memória da instância. Em Edge/serverless
// (Vercel), cada isolate/região tem o seu — a proteção é BEST-EFFORT (funciona 100%
// local/instância única; em produção distribuída atenua, mas não é global). Para
// rate limiting distribuído de verdade, trocar por Upstash Redis (@upstash/ratelimit)
// mantendo esta MESMA assinatura (rateLimit). É Edge-safe: só usa Map/Date.

interface Bucket { count: number; reset: number }

const store = new Map<string, Bucket>()
const MAX_KEYS = 10_000 // teto de memória: evita crescimento ilimitado por muitos IPs

export interface RateResult { ok: boolean; remaining: number; retryAfter: number }

export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now()
  let b = store.get(key)
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + windowMs }
    if (store.size > MAX_KEYS) store.clear() // limpeza grosseira quando estoura o teto
    store.set(key, b)
  }
  b.count++
  const ok = b.count <= limit
  return { ok, remaining: Math.max(0, limit - b.count), retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) }
}
