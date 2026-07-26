// src/lib/synced.ts
// Camada de sincronização por conta. Os módulos (portfólio, CRM, alertas) continuam
// lendo/gravando de forma SÍNCRONA num cache local (localStorage), mas cada escrita
// é espelhada no servidor (/api/user-data) e, no login, o cache é hidratado a partir
// da conta — assim os dados passam a viver na CONTA e sincronizam entre máquinas.

// Mapa: chave localStorage → chave no servidor (user_data.chave).
const KEY_TO_CHAVE: Record<string, string> = {
  'govhealth:empresa': 'empresa',        // setup unificado (fonte de verdade)
  'govhealth:portfolio': 'portfolio',    // legado — mantido p/ migração/hidratação
  'govhealth:crm:deals': 'crm',
  'govhealth:alertas:configs': 'alertas-config',
  'govhealth:alertas:notifs': 'alertas-notif',
  'govhealth:preferences': 'perfil',     // legado — mantido p/ migração/hidratação
}
const UID_KEY = 'govhealth:__uid'
export const HYDRATED_EVENT = 'govhealth:hydrated'

/** Leitura síncrona do cache local (com fallback). */
export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

const timers: Record<string, ReturnType<typeof setTimeout>> = {}

/** Grava no cache local e agenda o push para o servidor (debounce). */
export function writeLocal(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota */ }
  const chave = KEY_TO_CHAVE[key]
  if (!chave) return
  clearTimeout(timers[key])
  timers[key] = setTimeout(() => { void pushRemote(chave, value) }, 600)
}

async function pushRemote(chave: string, valor: unknown): Promise<void> {
  try {
    await fetch('/api/user-data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, valor }),
    })
  } catch { /* offline: fica no cache local até o próximo save */ }
}

/**
 * Hidrata o cache local a partir da conta. Se a conta mudou (outro usuário no mesmo
 * navegador), limpa o cache antes — evita vazar dados entre contas. Dispara um evento
 * ao terminar para as páginas recarregarem.
 */
export async function hydrateFromServer(email: string | null | undefined): Promise<void> {
  if (typeof window === 'undefined' || !email) return
  const atual = localStorage.getItem(UID_KEY)
  if (atual !== email) {
    for (const key of Object.keys(KEY_TO_CHAVE)) localStorage.removeItem(key)
    localStorage.setItem(UID_KEY, email)
  }
  await Promise.all(
    Object.entries(KEY_TO_CHAVE).map(async ([key, chave]) => {
      try {
        const r = await fetch(`/api/user-data?chave=${chave}`)
        const j = await r.json()
        if (j && j.valor != null) localStorage.setItem(key, JSON.stringify(j.valor))
      } catch { /* mantém o cache local */ }
    }),
  )
  window.dispatchEvent(new Event(HYDRATED_EVENT))
}

/** Limpa o cache local dos módulos (usado ao sair). */
export function clearLocalData(): void {
  if (typeof window === 'undefined') return
  for (const key of Object.keys(KEY_TO_CHAVE)) localStorage.removeItem(key)
  localStorage.removeItem(UID_KEY)
}
