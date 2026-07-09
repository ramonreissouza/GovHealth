'use client'
// src/app/esqueci-senha/page.tsx — pedido de redefinição de senha.
// Envia o e-mail e SEMPRE mostra a mesma confirmação (anti-enumeração).

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Loader2, MailCheck, ArrowLeft } from 'lucide-react'

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/senha/solicitar', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
    } catch { /* resposta é sempre ok; ignora erro de rede na UI */ }
    finally { setLoading(false); setEnviado(true) }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center gap-2 mb-8">
          <Image src="/logo-govhealth.png" alt="GovHealth" width={170} height={77} priority className="h-9 w-auto" />
          <span className="font-mono-custom text-[11px] text-faint tracking-wide">Sales Intelligence</span>
        </div>

        <div className="bg-bg2 border border-subtle rounded-xl p-7">
          {enviado ? (
            <div className="text-center">
              <div className="w-11 h-11 rounded-full bg-accent/15 flex items-center justify-center mx-auto mb-4">
                <MailCheck size={20} className="text-accent" />
              </div>
              <h1 className="text-[17px] font-heading font-semibold text-strong mb-2">Verifique seu e-mail</h1>
              <p className="text-[13px] text-muted leading-relaxed">
                Se houver uma conta associada a <strong className="text-strong">{email.trim().toLowerCase()}</strong>,
                enviamos um link para redefinir a senha. O link expira em 30 minutos.
              </p>
              <p className="text-[12px] text-faint mt-3">Não recebeu? Verifique o spam ou tente novamente em alguns instantes.</p>
              <Link href="/login" className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline mt-5">
                <ArrowLeft size={13} /> Voltar para o login
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[17px] font-heading font-semibold text-strong mb-1">Esqueceu a senha?</h1>
              <p className="text-[13px] text-muted mb-6">Informe seu e-mail e enviaremos um link para você criar uma nova senha.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Email</label>
                  <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@empresa.com.br"
                    className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors" />
                </div>
                <button type="submit" disabled={loading || !email.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-accent text-black font-semibold text-[13px] py-2.5 rounded-lg hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60">
                  {loading && <Loader2 size={14} className="animate-spin" />} Enviar link de redefinição
                </button>
              </form>
              <Link href="/login" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-strong transition-colors mt-5">
                <ArrowLeft size={13} /> Voltar para o login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
