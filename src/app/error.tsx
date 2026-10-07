'use client'
// src/app/error.tsx — a tela de quando uma página quebra no render. Antes dela, valia
// a do Next ("Application error"), e o erro ficava só no console de quem o viu.
// Agora ele vai para o SigNoz (TS-540), com o mesmo `digest` do lado do servidor.

import { useEffect } from 'react'
import { reportarErroCliente } from '@/lib/erro-cliente'

export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportarErroCliente(error, 'render') }, [error])

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="font-heading text-xl font-semibold">Algo deu errado nesta tela</h1>
        <p className="text-muted text-sm">
          O erro já foi registrado para a equipe. Tente de novo; se continuar, use o
          “Reporte um problema” e cite o código abaixo.
        </p>
        {error.digest && <p className="font-mono text-xs text-muted">código {error.digest}</p>}
        <button onClick={reset} className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent/90">
          Tentar de novo
        </button>
      </div>
    </main>
  )
}
