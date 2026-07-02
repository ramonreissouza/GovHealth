// src/lib/notifications.ts — Notificações do navegador (item #5 do TOP10 v2).
// Alertas só dentro da plataforma não mudam comportamento; o vendedor precisa ser
// avisado. Esta camada usa a Notification API nativa do navegador — custo zero,
// sem chave/servidor. (Web Push com service worker/VAPID e digest por e-mail ficam
// como próximas camadas.) A preferência do usuário fica em localStorage.

const PREF_KEY = 'govhealth:notify-enabled'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function getNotifyEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(PREF_KEY) === '1'
}

export function setNotifyEnabled(v: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PREF_KEY, v ? '1' : '0')
}

/** Só notifica se: suportado + permissão concedida + preferência ligada. */
export function canNotify(): boolean {
  return notificationsSupported() && Notification.permission === 'granted' && getNotifyEnabled()
}

export function showBrowserNotification(
  title: string,
  opts?: { body?: string; tag?: string; url?: string },
): void {
  if (!canNotify()) return
  try {
    const n = new Notification(title, { body: opts?.body, tag: opts?.tag, icon: '/favicon.ico' })
    if (opts?.url) {
      n.onclick = () => {
        window.focus()
        window.location.href = opts.url as string
      }
    }
  } catch {
    /* alguns navegadores bloqueiam Notification fora de gesto do usuário — ignora */
  }
}
