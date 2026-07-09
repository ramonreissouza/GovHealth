'use client'
// src/app/redefinir-senha/page.tsx — cria a nova senha a partir do link do e-mail.
// Lê ?token=...&e=... da URL; valida força e confirma; ao concluir, leva ao login.

import { useState, Suspense, FormEvent } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { clsx } from 'clsx'
import { Loader2, Eye, EyeOff, Check, AlertTriangle, CheckCircle2, ArrowLeft } from 'lucide-react'

export default function RedefinirSenhaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-faint">Carregando…</div>}>
      <Redefinir />
    </Suspense>
  )
}

function Redefinir() {
  const sp = useSearchParams()
  const router = useRouter()
  const token = sp.get('token') ?? ''
  const email = (sp.get('e') ?? '').toLowerCase()

  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [ver, setVer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const linkInvalido = !token || !email
  const forteOk = nova.trim().length >= 8 && /[A-Za-z]/.test(nova) && /[0-9]/.test(nova)
  const confereOk = nova.length > 0 && nova === confirma
  const podeEnviar = forteOk && confereOk && !loading

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!forteOk) { setErro('A senha precisa ter ao menos 8 caracteres, com letras e números.'); return }
    if (!confereOk) { setErro('A confirmação não confere com a nova senha.'); return }
    setLoading(true)
    try {
      const r = await fetch('/api/senha/redefinir', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token, novaSenha: nova }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setOk(true); setTimeout(() => router.replace('/login'), 2500) }
      else setErro(d.error ?? 'Não foi possível redefinir a senha.')
    } catch {
      setErro('Não foi possível redefinir a senha.')
    } finally { setLoading(false) }
  }

  const inputCls = 'w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 pr-10 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors'

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center gap-2 mb-8">
          <Image src="/logo-govhealth.png" alt="GovHealth" width={170} height={77} priority className="h-9 w-auto" />
          <span className="font-mono-custom text-[11px] text-faint tracking-wide">Sales Intelligence</span>
        </div>

        <div className="bg-bg2 border border-subtle rounded-xl p-7">
          {linkInvalido ? (
            <div className="text-center">
              <div className="w-11 h-11 rounded-full bg-red-400/15 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <h1 className="text-[17px] font-heading font-semibold text-strong mb-2">Link inválido</h1>
              <p className="text-[13px] text-muted">Este link de redefinição está incompleto ou expirou. Solicite um novo.</p>
              <Link href="/esqueci-senha" className="inline-block text-[12px] text-accent hover:underline mt-5">Pedir novo link</Link>
            </div>
          ) : ok ? (
            <div className="text-center">
              <div className="w-11 h-11 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={20} className="text-emerald-400" />
              </div>
              <h1 className="text-[17px] font-heading font-semibold text-strong mb-2">Senha redefinida!</h1>
              <p className="text-[13px] text-muted">Sua senha foi alterada. Redirecionando para o login…</p>
              <Link href="/login" className="inline-block text-[12px] text-accent hover:underline mt-5">Ir para o login agora</Link>
            </div>
          ) : (
            <>
              <h1 className="text-[17px] font-heading font-semibold text-strong mb-1">Criar nova senha</h1>
              <p className="text-[13px] text-muted mb-6">Definindo a senha de <strong className="text-strong">{email}</strong>.</p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Nova senha</label>
                  <div className="relative">
                    <input type={ver ? 'text' : 'password'} required autoFocus value={nova} onChange={(e) => setNova(e.target.value)}
                      autoComplete="new-password" placeholder="••••••••" className={inputCls} />
                    <button type="button" onClick={() => setVer((v) => !v)} tabIndex={-1}
                      aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-strong transition-colors">
                      {ver ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <div className={clsx('text-[11px] mt-1.5 flex items-center gap-1', nova.length === 0 ? 'text-faint' : forteOk ? 'text-emerald-400' : 'text-amber-400')}>
                    {nova.length > 0 && (forteOk ? <Check size={11} /> : <AlertTriangle size={11} />)}
                    Mínimo 8 caracteres, com letras e números.
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Confirmar nova senha</label>
                  <div className="relative">
                    <input type={ver ? 'text' : 'password'} required value={confirma} onChange={(e) => setConfirma(e.target.value)}
                      autoComplete="new-password" placeholder="••••••••" className={inputCls} />
                  </div>
                  {confirma.length > 0 && !confereOk && <div className="text-[11px] mt-1.5 text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> As senhas não conferem.</div>}
                </div>
                {erro && <p className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{erro}</p>}
                <button type="submit" disabled={!podeEnviar}
                  className="w-full flex items-center justify-center gap-2 bg-accent text-black font-semibold text-[13px] py-2.5 rounded-lg hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60 disabled:cursor-not-allowed">
                  {loading && <Loader2 size={14} className="animate-spin" />} Redefinir senha
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
