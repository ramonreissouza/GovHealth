'use client'
// src/components/ErrosDoNavegador.tsx — pega o que as telas de erro (app/error.tsx,
// app/global-error.tsx) não pegam: erro em handler de clique, em setTimeout, em
// promessa sem catch. O React só leva para a tela de erro o que quebra no render.

import { useEffect } from 'react'
import { reportarErroCliente } from '@/lib/erro-cliente'

export default function ErrosDoNavegador() {
  useEffect(() => {
    const aoErro = (ev: ErrorEvent) => {
      // Script de terceiro (extensão, Stripe) chega como "Script error." sem nada:
      // o navegador esconde o detalhe de outra origem, e não há o que investigar.
      if (!ev.error && ev.message === 'Script error.') return
      reportarErroCliente(ev.error ?? ev.message, 'janela')
    }
    const aoRejeitar = (ev: PromiseRejectionEvent) => reportarErroCliente(ev.reason, 'promessa')
    window.addEventListener('error', aoErro)
    window.addEventListener('unhandledrejection', aoRejeitar)
    return () => {
      window.removeEventListener('error', aoErro)
      window.removeEventListener('unhandledrejection', aoRejeitar)
    }
  }, [])

  return null
}
