// src/lib/ip.ts — IP do cliente atrás do nginx do host + Traefik. Edge-safe (sem import).
//
// O PRIMEIRO item do X-Forwarded-For é o que o cliente quiser mandar: com
// `$proxy_add_x_forwarded_for` o nginx só ACRESCENTA ao cabeçalho recebido. Usar esse
// item no rate limit do login deixava trocar de "IP" a cada tentativa. O X-Real-IP,
// que o nginx define com `$remote_addr`, não passa pelo cliente — por isso vem
// primeiro. O XFF fica de fallback (dev local, sem nginx).

export function ipCliente(get: (nome: string) => string | null | undefined): string | null {
  const real = get('x-real-ip')?.trim()
  if (real) return real
  const xff = get('x-forwarded-for')
  if (!xff) return null
  // Sem X-Real-IP, o item mais à DIREITA é o do último proxy (ou o próprio cliente,
  // se não houver proxy): é o único que o cliente não controla.
  const itens = xff.split(',').map((s) => s.trim()).filter(Boolean)
  return itens[itens.length - 1] ?? null
}
