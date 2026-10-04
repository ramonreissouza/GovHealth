'use client'
// src/components/PushReconcilia.tsx — ao abrir o app logado, confere se o servidor ainda
// conhece a inscrição de push DESTE aparelho. Não desenha nada.
//
// Por que: o navegador troca a inscrição sozinho (pushsubscriptionchange, em public/sw.js)
// e o service worker avisa o servidor, mas isso falha com a sessão vencida, sem rede ou
// em navegador que não informa a inscrição antiga. Sem esta conferência o aparelho
// ficaria mudo até a pessoa abrir as configurações. Só age onde a pessoa ATIVOU o aviso
// (há endpoint salvo); um aparelho removido pela lista não volta (o servidor responde
// 409 e o salvo é apagado).

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { chaveBytes, endpointSalvo, registrarNoServidor, salvarEndpoint } from '@/lib/push-cliente'

export default function PushReconcilia() {
  const { status } = useSession()
  const feito = useRef(false)

  useEffect(() => {
    if (status !== 'authenticated' || feito.current) return
    feito.current = true
    void (async () => {
      const salvo = endpointSalvo()
      if (!salvo || !('serviceWorker' in navigator) || !('PushManager' in window)) return
      if (Notification.permission !== 'granted') { salvarEndpoint(null); return }
      const reg = await navigator.serviceWorker.getRegistration('/')
      if (!reg) return
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        // O navegador perdeu a inscrição e o service worker não refez: refaz aqui.
        const info = await fetch('/api/push').then((r) => (r.ok ? r.json() : null)).catch(() => null)
        if (!info?.configurado || !info.chave) return
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(info.chave) })
      }
      if (sub.endpoint === salvo) return
      await registrarNoServidor(sub, salvo)
    })().catch(() => { /* tenta de novo na próxima abertura */ })
  }, [status])

  return null
}
