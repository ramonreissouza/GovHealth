'use client'
// src/app/aceitar-convite/page.tsx — PÚBLICO. O convidado cria a própria senha.

import { Suspense, useEffect, useState, FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Loader2, CheckCircle2 } from 'lucide-react'

export default function AceitarConvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-faint">Carregando…</div>}>
      <Inner />
    </Suspense>
  )
}

const MSG: Record<string, string> = {
  invalido: 'Convite inválido ou expirado.',
  email_existe: 'Já existe uma conta com este e-mail.',
  senha_curta: 'Escolha uma senha de ao menos 6 caracteres.',
  sem_vagas: 'A equipe atingiu o limite de usuários do plano.',
}

function Inner() {
  const sp = useSearchParams()
  const token = sp.get('token') ?? ''
  const [conv, setConv] = useState<{ email: string; empresa: string | null } | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'invalido' | 'criado'>('carregando')
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) { setEstado('invalido'); return }
    fetch(`/api/equipe/aceitar?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => { if (d.erro) setEstado('invalido'); else { setConv(d); setEstado('ok') } })
      .catch(() => setEstado('invalido'))
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault(); setErro('')
    if (senha.length < 6) { setErro(MSG.senha_curta); return }
    setLoading(true)
    const r = await fetch('/api/equipe/aceitar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, senha, nome }),
    })
    const d = await r.json().catch(() => ({}))
    setLoading(false)
    if (!r.ok) { setErro(MSG[d.erro] ?? 'Não foi possível concluir.'); return }
    setEstado('criado')
  }

  const inp = 'w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors'

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center gap-2 mb-8">
          <Image src="/logo-govhealth.png" alt="GovHealth" width={170} height={77} priority className="h-9 w-auto" />
          <span className="font-mono-custom text-[11px] text-faint tracking-wide">Sales Intelligence</span>
        </div>

        <div className="bg-bg2 border border-subtle rounded-xl p-7">
          {estado === 'carregando' ? (
            <div className="flex items-center justify-center gap-2 text-faint text-[13px] py-6"><Loader2 size={16} className="animate-spin" /> Verificando convite…</div>
          ) : estado === 'invalido' ? (
            <div className="text-center py-4">
              <p className="text-[14px] text-strong mb-1">Convite inválido ou expirado</p>
              <p className="text-[12px] text-muted mb-4">Peça um novo convite ao titular da conta.</p>
              <Link href="/login" className="text-[12px] text-accent hover:underline">Ir para o login</Link>
            </div>
          ) : estado === 'criado' ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="text-accent mx-auto mb-3" />
              <p className="text-[15px] font-semibold text-strong mb-1">Conta criada!</p>
              <p className="text-[12px] text-muted mb-5">Agora é só entrar com o seu e-mail e a senha que você escolheu.</p>
              <Link href="/login" className="inline-block bg-accent text-black font-semibold text-[13px] px-5 py-2.5 rounded-lg hover:bg-accent/90">Entrar</Link>
            </div>
          ) : (
            <>
              <h1 className="text-[17px] font-heading font-semibold text-strong mb-1">Aceitar convite</h1>
              <p className="text-[13px] text-muted mb-5">
                Você foi convidado{conv?.empresa ? <> para a conta da <strong className="text-strong">{conv.empresa}</strong></> : ''}.
                Crie a sua própria senha — cada pessoa tem o seu login.
              </p>
              <form onSubmit={submit} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">E-mail</label>
                  <input className={inp + ' opacity-70'} value={conv?.email ?? ''} disabled />
                </div>
                <div>
                  <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Seu nome</label>
                  <input className={inp} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
                </div>
                <div>
                  <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Criar senha *</label>
                  <input type="password" className={inp} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mín. 6 caracteres" />
                </div>
                {erro && <p className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{erro}</p>}
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-accent text-black font-semibold text-[13px] py-2.5 rounded-lg hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60">
                  {loading && <Loader2 size={14} className="animate-spin" />} Criar minha conta
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
