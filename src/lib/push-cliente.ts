// src/lib/push-cliente.ts — o lado do navegador do aviso por push, compartilhado pela
// tela "Aviso no celular" e pela conferência que roda ao abrir o app
// (src/components/PushReconcilia.tsx). Sem nada de servidor.

/** Onde o aparelho guarda o endpoint que o SERVIDOR conhece (o último aceito). */
export const CHAVE_ENDPOINT = 'govhealth:push-endpoint'

export function endpointSalvo(): string | null {
  try { return localStorage.getItem(CHAVE_ENDPOINT) } catch { return null }
}
export function salvarEndpoint(endpoint: string | null) {
  try {
    if (endpoint) localStorage.setItem(CHAVE_ENDPOINT, endpoint)
    else localStorage.removeItem(CHAVE_ENDPOINT)
  } catch { /* navegação privada: a conferência só não acontece */ }
}

/** Chave VAPID (base64url) → bytes, como o PushManager pede. */
export function chaveBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const bruto = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(bruto.length))
  for (let i = 0; i < bruto.length; i++) out[i] = bruto.charCodeAt(i)
  return out
}

/** "Chrome no Android": para a pessoa reconhecer o aparelho na lista. */
export function nomeAparelho(): string {
  const ua = navigator.userAgent
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'aparelho'
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  return `${nav} no ${so}`
}

/**
 * Registra a inscrição no servidor. Com `substitui`, é uma RENOVAÇÃO: o servidor só
 * aceita se aquele endpoint antigo ainda for desta pessoa — um aparelho removido pela
 * lista não volta sozinho. 'removido' = o servidor recusou a troca (409).
 */
export async function registrarNoServidor(sub: PushSubscription, substitui?: string | null): Promise<'ok' | 'removido' | 'erro'> {
  try {
    const r = await fetch('/api/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), aparelho: nomeAparelho(), substitui: substitui ?? undefined }),
    })
    if (r.ok) { salvarEndpoint(sub.endpoint); return 'ok' }
    if (r.status === 409) { salvarEndpoint(null); return 'removido' }
    return 'erro'
  } catch { return 'erro' }
}
