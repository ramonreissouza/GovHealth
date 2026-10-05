// src/lib/checkout-cookie.ts — correlação entre o checkout e a página de sucesso.
//
// O session_id do Stripe volta na URL de /assinar/sucesso, e URL vaza: histórico,
// logs de proxy, cabeçalho Referer. Ele sozinho não pode abrir o estado da conta de
// alguém (revisão da #63). Por isso o checkout cria um valor aleatório num cookie
// HttpOnly, com caminho restrito à rota de status, e guarda no banco só o SHA-256 dele.
// A rota de status só detalha quando o cookie bate.

import { createHash, timingSafeEqual } from 'node:crypto'

export const COOKIE_CHECKOUT = 'gh_checkout'

export function hashDoNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

/** O cookie apresentado corresponde ao hash gravado? Comparação em tempo constante. */
export function nonceConfere(nonce: string | undefined, hashGravado: string | null): boolean {
  if (!nonce || !hashGravado) return false
  const a = Buffer.from(hashDoNonce(nonce), 'hex')
  const b = Buffer.from(hashGravado, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** "ramon@gmail.com" → "r••••@gmail.com": dá para reconhecer, não para copiar. */
export function mascararEmail(email: string): string {
  const [local, dominio] = email.split('@')
  if (!dominio) return '••••'
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 8)))}@${dominio}`
}
