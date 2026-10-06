'use client'
// src/app/global-error.tsx — quando o que quebra é o próprio layout raiz. Ela o
// substitui inteiro, por isso tem <html> e <body> próprios e não usa o tema: o CSS
// global pode nem ter carregado. O erro vai para o SigNoz como o de app/error.tsx.

import { useEffect } from 'react'
import { reportarErroCliente } from '@/lib/erro-cliente'

export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportarErroCliente(error, 'global') }, [error])

  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, padding: 16, textAlign: 'center' }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 20 }}>O GovHealth não conseguiu abrir</h1>
          <p style={{ color: '#555', fontSize: 14 }}>
            O erro já foi registrado para a equipe. Tente de novo em instantes.
          </p>
          {error.digest && <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#777' }}>código {error.digest}</p>}
          <button onClick={reset} style={{ padding: '8px 20px', borderRadius: 999, border: '1px solid #ccc', background: 'white', cursor: 'pointer' }}>
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  )
}
