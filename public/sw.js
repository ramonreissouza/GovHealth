// public/sw.js — service worker do GovHealth: só o aviso no celular (Web Push).
// Não guarda páginas em cache: o app continua sempre online, como antes.
//
// O servidor manda (src/lib/push.ts): { titulo, corpo, url, vi?, tag?, urgente? }.
// - Tocar no aviso abre a página do "Vi" (confirma e leva ao portal) ou `url`.
// - O botão "Vi, estou cuidando" (Android e desktop; o iPhone não mostra botões)
//   confirma direto, sem abrir nada: a mesma rota do link do e-mail.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { corpo: e.data ? e.data.text() : '' } }
  const opcoes = {
    body: d.corpo || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: !!d.urgente,
    data: { url: d.url || '/radar', vi: d.vi || null },
    actions: d.vi ? [{ action: 'vi', title: 'Vi, estou cuidando' }] : [],
  }
  e.waitUntil(self.registration.showNotification(d.titulo || 'GovHealth', opcoes))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const { url, vi } = e.notification.data || {}
  if (e.action === 'vi' && vi) {
    const t = new URL(vi).searchParams.get('t') || ''
    e.waitUntil(
      fetch('/api/radar/vi', { method: 'POST', body: new URLSearchParams({ t }) })
        .then((r) => self.registration.showNotification(r.ok ? 'Confirmado' : 'Não deu para confirmar', {
          body: r.ok ? 'A equipe fica sabendo que você está cuidando.' : 'Abra o aviso no Radar para confirmar.',
          icon: '/icon-192.png', tag: 'vi-confirmacao',
        }))
        .catch(() => {}),
    )
    return
  }
  e.waitUntil(self.clients.openWindow(vi || url || '/radar'))
})

// O navegador pode trocar a inscrição sozinho (chave renovada, dados limpos). Sem isto,
// o aparelho para de receber sem ninguém saber.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const r = await fetch('/api/push')
    if (!r.ok) return
    const { chave } = await r.json()
    if (!chave) return
    const pad = '='.repeat((4 - (chave.length % 4)) % 4)
    const bruto = atob((chave + pad).replace(/-/g, '+').replace(/_/g, '/'))
    const applicationServerKey = Uint8Array.from(bruto, (c) => c.charCodeAt(0))
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    await fetch('/api/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), aparelho: 'renovado pelo navegador' }),
    })
  })())
})
