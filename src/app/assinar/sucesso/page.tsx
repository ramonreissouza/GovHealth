'use client'
// src/app/assinar/sucesso/page.tsx — retorno do Stripe Checkout. Confirma o
// estado da assinatura (polling curto no webhook) e orienta o próximo passo.

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, Mail, ArrowRight } from 'lucide-react'

export default function SucessoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-faint">Carregando…</div>}>
      <Sucesso />
    </Suspense>
  )
}

function Sucesso() {
  const sp = useSearchParams()
  const sessionId = sp.get('session_id')
  const [status, setStatus] = useState<'carregando' | 'ativa' | 'processando'>('carregando')
  const [email, setEmail] = useState<string>('')

  useEffect(() => {
    if (!sessionId) { setStatus('processando'); return }
    let vivo = true
    let tentativas = 0
    const checar = async () => {
      tentativas++
      try {
        const r = await fetch(`/api/assinaturas/status?session_id=${encodeURIComponent(sessionId)}`)
        const d = await r.json().catch(() => ({}))
        if (!vivo) return
        if (d.email) setEmail(d.email)
        if (d.status === 'ativa') { setStatus('ativa'); return }
      } catch { /* rede — tenta de novo */ }
      if (vivo) {
        if (tentativas >= 6) { setStatus('processando'); return } // ~15s: webhook pode atrasar
        setTimeout(checar, 2500)
      }
    }
    checar()
    return () => { vivo = false }
  }, [sessionId])

  return (
    <div className="min-h-screen bg-bg text-strong flex items-center justify-center px-6">
      <div className="max-w-[460px] text-center">
        {status === 'carregando' ? (
          <>
            <Loader2 size={38} className="text-accent mx-auto mb-4 animate-spin" />
            <h1 className="font-heading font-bold text-[22px] mb-2">Confirmando seu pagamento…</h1>
            <p className="text-[14px] text-muted">Só um instante — estamos ativando sua assinatura.</p>
          </>
        ) : (
          <>
            <CheckCircle2 size={44} className="text-accent mx-auto mb-4" />
            <h1 className="font-heading font-bold text-[24px] mb-2">
              {status === 'ativa' ? 'Assinatura ativada! 🎉' : 'Pagamento recebido!'}
            </h1>
            <p className="text-[14px] text-muted mb-4">
              {status === 'ativa'
                ? 'Seu acesso já está liberado.'
                : 'Estamos processando a confirmação — leva só alguns instantes.'}
            </p>
            <div className="bg-bg2 border border-subtle rounded-xl p-4 flex items-start gap-2.5 text-left mb-6">
              <Mail size={16} className="text-accent flex-shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-muted">
                Enviamos os dados de acesso {email ? <>para <strong className="text-strong">{email}</strong></> : 'para o seu e-mail'} (verifique também o spam). A nota fiscal é emitida em seguida.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Link href="/login" className="inline-flex items-center gap-2 text-[14px] font-semibold bg-accent text-black px-5 py-2.5 rounded-lg hover:bg-accent2">
                Entrar na plataforma <ArrowRight size={15} />
              </Link>
              <Link href="/inicio" className="text-[13px] text-muted hover:text-strong">Voltar ao início</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
