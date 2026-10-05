'use client'
// src/app/assinar/sucesso/page.tsx — retorno do Stripe Checkout. Confirma o
// estado da assinatura (polling curto no webhook) e orienta o próximo passo.
//
// A mensagem sobre o e-mail depende do que o webhook GRAVOU (conta nova? e-mail saiu?),
// não de uma suposição. Até 05/10/2026 a tela dizia "enviamos os dados de acesso" sempre —
// inclusive quando o e-mail não saía, e para conta nova a senha só existe nesse e-mail.

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, Mail, ArrowRight, AlertTriangle } from 'lucide-react'
import { CONTATO_EMAIL } from '@/lib/empresa-legal'

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
  // null = o webhook ainda não terminou as boas-vindas (ou não terminou a tempo).
  const [contaNova, setContaNova] = useState<boolean | null>(null)
  const [emailEnviado, setEmailEnviado] = useState<boolean | null>(null)
  const [validadeLinkHoras, setValidadeLinkHoras] = useState<number | null>(null)

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
        if (typeof d.contaNova === 'boolean') setContaNova(d.contaNova)
        if (typeof d.emailEnviado === 'boolean') setEmailEnviado(d.emailEnviado)
        if (typeof d.validadeLinkHoras === 'number') setValidadeLinkHoras(d.validadeLinkHoras)
        if (d.status === 'ativa') {
          setStatus('ativa')
          // Ativa não basta: o e-mail sai DEPOIS da ativação. Espera o resultado dele.
          if (typeof d.emailEnviado === 'boolean') return
        }
      } catch { /* rede — tenta de novo */ }
      if (vivo) {
        if (tentativas >= 8) { setStatus((s) => (s === 'ativa' ? 'ativa' : 'processando')); return } // ~20s: webhook pode atrasar
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
            <AvisoDeAcesso email={email} contaNova={contaNova} emailEnviado={emailEnviado} validadeLinkHoras={validadeLinkHoras} />
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

/** O que dizer sobre o acesso, a partir do que o webhook gravou. */
function AvisoDeAcesso({ email, contaNova, emailEnviado, validadeLinkHoras }: { email: string; contaNova: boolean | null; emailEnviado: boolean | null; validadeLinkHoras: number | null }) {
  const quem = email ? <strong className="text-strong">{email}</strong> : 'o seu e-mail'

  // Conta criada agora e o e-mail com o link de criar senha não saiu: sem isto a pessoa
  // pagou e não tem como entrar. O webhook segue tentando (o Stripe reenvia), e o
  // "Esqueci minha senha" emite um link novo para o mesmo e-mail.
  if (contaNova === true && emailEnviado === false) {
    return (
      <div className="bg-bg2 border border-amber/40 rounded-xl p-4 flex items-start gap-2.5 text-left mb-6">
        <AlertTriangle size={16} className="text-amber flex-shrink-0 mt-0.5" />
        <p className="text-[12.5px] text-muted">
          Sua conta foi criada e o pagamento está confirmado, mas o e-mail para {quem} com o link de criar a senha ainda
          não saiu. Use <Link href="/esqueci-senha" className="text-accent hover:underline">Esqueci minha senha</Link>{' '}
          com o e-mail da assinatura, ou escreva para{' '}
          <a href={`mailto:${CONTATO_EMAIL}`} className="text-accent hover:underline">{CONTATO_EMAIL}</a>.
        </p>
      </div>
    )
  }

  let texto: React.ReactNode
  if (contaNova === false) {
    // Já tinha conta: não existe senha nova, o que muda é o plano.
    texto = <>{quem} já tinha conta: entre com a senha de sempre.{emailEnviado ? ' Mandamos a confirmação da assinatura por e-mail.' : ''} A nota fiscal é emitida em seguida.</>
  } else if (emailEnviado === true) {
    texto = <>Enviamos para {quem} o link para você criar sua senha (verifique também o spam).{validadeLinkHoras ? ` Ele vale por ${validadeLinkHoras} horas.` : ''} A nota fiscal é emitida em seguida.</>
  } else {
    // Ainda sem resposta do webhook: não afirma envio que não aconteceu.
    texto = <>Os dados de acesso vão para {quem} em instantes (verifique também o spam). A nota fiscal é emitida em seguida.</>
  }
  return (
    <div className="bg-bg2 border border-subtle rounded-xl p-4 flex items-start gap-2.5 text-left mb-6">
      <Mail size={16} className="text-accent flex-shrink-0 mt-0.5" />
      <p className="text-[12.5px] text-muted">{texto}</p>
    </div>
  )
}
