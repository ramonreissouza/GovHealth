// src/lib/rate-limit.ts — rate limiting (janela fixa).
// Usado no middleware (itens 6 e 9 do checklist) contra brute force de login e abuso/custo
// das APIs de dados.
//
// DOIS backends, mesma assinatura (agora ASYNC):
//  1) Upstash Redis (distribuído/global) — ativo quando UPSTASH_REDIS_REST_URL + _TOKEN
//     existem. REST/fetch → Edge-safe. Contador compartilhado entre todos os isolates/regiões.
//  2) Fallback em memória (best-effort por instância) — quando o Upstash não está configurado
//     OU quando uma chamada ao Upstash falha (rede) — nunca bloqueia o tráfego por erro de infra.

import { Redis } from '@upstash/redis'

interface Bucket { count: number; reset: number }

const store = new Map<string, Bucket>()
const MAX_KEYS = 10_000 // teto de memória: evita crescimento ilimitado por muitos IPs

export interface RateResult { ok: boolean; remaining: number; retryAfter: number }

/** Fallback em memória (janela fixa, por instância). Síncrono. */
function rateLimitMemoria(key: string, limit: number, windowMs: number): RateResult {
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

// Cliente Upstash lazy — só instancia se as duas envs existirem. Edge-safe (usa fetch).
let redis: Redis | null = null
let redisResolvido = false
function getRedis(): Redis | null {
  if (redisResolvido) return redis
  redisResolvido = true
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) redis = new Redis({ url, token })
  return redis
}

/**
 * Rate limit de janela fixa. Distribuído via Upstash quando configurado; senão em memória.
 * ASSINATURA: rateLimit(key, limit, windowMs) → Promise<RateResult>.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const r = getRedis()
  if (!r) return rateLimitMemoria(key, limit, windowMs)

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000))
  const rk = `rl:${key}`
  try {
    // INCR + TTL num pipeline. TTL === -1 significa "chave sem expiração" (foi o 1º hit
    // desta janela) → define o EXPIRE. Assim a janela expira sozinha no Redis.
    const [count, ttl] = await r.pipeline().incr(rk).ttl(rk).exec<[number, number]>()
    let retryAfter = ttl
    if (ttl < 0) { await r.expire(rk, windowSec); retryAfter = windowSec }
    const ok = count <= limit
    return { ok, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, retryAfter) }
  } catch {
    // Falha de rede/Upstash → não punir o usuário; cai no fallback local.
    return rateLimitMemoria(key, limit, windowMs)
  }
}
