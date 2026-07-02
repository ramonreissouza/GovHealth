'use client'
// src/app/login/page.tsx

import { signIn, getSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, FormEvent } from 'react'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  useEffect(() => {
    getSession().then((s) => {
      if (s) router.replace('/')
    })
  }, [router])

  async function handleCredentials(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (res?.error) {
      setError('Email ou senha incorretos.')
    } else {
      router.replace('/')
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    await signIn('google', { callbackUrl: '/' })
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        {/* Logo */}
        <div className="flex items-center gap-3 justify-center mb-10">
          <div className="w-9 h-9 bg-accent rounded-lg flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 16 16" fill="none" className="w-5 h-5">
              <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="#000" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" fill="#000"/>
            </svg>
          </div>
          <div>
            <div className="font-heading font-bold text-[18px] text-strong leading-none">GovHealth.ai</div>
            <div className="font-mono-custom text-[11px] text-faint mt-0.5 tracking-wide">Sales Intelligence</div>
          </div>
        </div>

        <div className="bg-bg2 border border-subtle rounded-xl p-7">
          <h1 className="text-[17px] font-heading font-semibold text-strong mb-1">Entrar na plataforma</h1>
          <p className="text-[13px] text-muted mb-6">Use sua conta Google ou credenciais de acesso.</p>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-gray-800 font-medium text-[13px] py-2.5 rounded-lg hover:bg-gray-100 transition-colors mb-4 disabled:opacity-60"
          >
            {googleLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            Entrar com Google
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-subtle" />
            <span className="text-[11px] text-faint font-mono-custom">OU</span>
            <div className="flex-1 h-px bg-subtle" />
          </div>

          {/* Credentials form */}
          <form onSubmit={handleCredentials} className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {error && (
              <p className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-accent text-black font-semibold text-[13px] py-2.5 rounded-lg hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Entrar
            </button>
          </form>

          <p className="text-[11px] text-faint text-center mt-5 font-mono-custom">
            Acesso restrito · <a href="mailto:contato@govhealth.ai?subject=Solicitação%20de%20acesso%20—%20GovHealth%20AI" className="text-accent hover:underline">Solicitar acesso</a>
          </p>
          <p className="text-[11px] text-faint text-center mt-2 font-mono-custom">
            <a href="/metodologia" className="text-muted hover:text-accent hover:underline">Fontes e metodologia</a>
          </p>
        </div>
      </div>
    </div>
  )
}
