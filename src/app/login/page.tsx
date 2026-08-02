'use client'
// src/app/login/page.tsx — Entrar (login) + Criar conta (autocadastro c/ teste
// grátis de 3 dias e escolha de plano). O modo inicial vem de ?criar=1 / ?plano=X.

import { signIn, getSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, Suspense, FormEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { clsx } from 'clsx'
import { Loader2, Check, Eye, EyeOff } from 'lucide-react'
import { PLANOS, planoPorId, formatarPreco } from '@/lib/planos'

type Modo = 'entrar' | 'criar'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-faint">Carregando…</div>}>
      <Auth />
    </Suspense>
  )
}

function Auth() {
  const router = useRouter()
  const sp = useSearchParams()
  const querPlano = planoPorId(sp.get('plano'))
  const [modo, setModo] = useState<Modo>(sp.get('criar') === '1' || querPlano ? 'criar' : 'entrar')

  useEffect(() => {
    getSession().then((s) => { if (s) router.replace('/') })
  }, [router])

  return (
    <div className="relative min-h-screen bg-bg flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Brilhos suaves da marca (azul→teal) para elevar o card sobre o fundo branco */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-accent/[0.08] blur-3xl" />
        <div className="absolute -bottom-32 -right-24 w-[440px] h-[440px] rounded-full bg-[#17b8a6]/[0.08] blur-3xl" />
      </div>
      <div className={clsx('w-full', modo === 'criar' ? 'max-w-[860px]' : 'max-w-[380px]')}>
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <Image src="/logo-govhealth.png" alt="GovHealth" width={170} height={77} priority className="h-9 w-auto" />
          <span className="font-mono-custom text-[11px] text-faint tracking-wide">Sales Intelligence</span>
        </div>

        {/* Toggle Entrar / Criar conta */}
        <div className="max-w-[380px] mx-auto grid grid-cols-2 gap-1 bg-bg2 border border-subtle rounded-lg p-1 mb-5">
          {(['entrar', 'criar'] as Modo[]).map((m) => (
            <button key={m} onClick={() => setModo(m)}
              className={clsx('text-[12.5px] font-semibold py-2 rounded-md transition-all',
                modo === m ? 'bg-gradient-brand text-white shadow-sm shadow-accent/20' : 'text-muted hover:text-strong')}>
              {m === 'entrar' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        {/* Empresa é sob consulta (contato) — não entra no fluxo de teste grátis. */}
        {modo === 'entrar' ? <Entrar router={router} /> : <Criar router={router} planoInicial={querPlano && !querPlano.contato ? (querPlano.id as 'essencial' | 'pro') : undefined} />}
      </div>
    </div>
  )
}

/* ───────────────────────── Login (2 etapas: senha → código) ───────────────────────── */
function Entrar({ router }: { router: ReturnType<typeof useRouter> }) {
  const sp = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [etapa, setEtapa] = useState<'senha' | 'codigo'>('senha')
  const [error, setError] = useState('')
  const [info, setInfo] = useState(sp.get('motivo') === 'sessao'
    ? 'Você foi desconectado: sua conta foi acessada em outro dispositivo.' : '')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function entrar(codigo?: string) {
    const res = await signIn('credentials', { email, password, otp: codigo ?? '', redirect: false })
    if (res?.error) { setError(codigo ? 'Código inválido ou expirado.' : 'Email ou senha incorretos.'); return false }
    router.replace('/'); return true
  }

  // Etapa 1: valida senha, checa sessão única e dispara o código (se 2FA ligado).
  async function handleCredentials(e: FormEvent) {
    e.preventDefault()
    setError(''); setInfo(''); setLoading(true)
    try {
      const r = await fetch('/api/auth/otp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), senha: password }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 429) { setError('Muitas tentativas. Aguarde um minuto.'); return }
      if (d.erro === 'sessao_ativa') { setError('Já existe uma sessão ativa em outro dispositivo. Saia de lá ou aguarde alguns minutos e tente de novo.'); return }
      if (d.erro === 'credenciais' || !r.ok) { setError('Email ou senha incorretos.'); return }
      if (d.precisaOtp) {
        setEtapa('codigo')
        setInfo(d.enviado ? `Enviamos um código de 6 dígitos para ${email.trim()}.` : 'Código gerado — verifique seu e-mail (pode levar 1 min).')
        return
      }
      await entrar() // 2FA desligado → entra direto
    } finally { setLoading(false) }
  }

  async function handleOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await entrar(otp.trim()) } finally { setLoading(false) }
  }

  async function handleGoogle() { setGoogleLoading(true); await signIn('google', { callbackUrl: '/' }) }

  return (
    <div className="max-w-[380px] mx-auto bg-bg2 border border-subtle rounded-xl p-7">
      <h1 className="text-[17px] font-heading font-semibold text-strong mb-1">Entrar na plataforma</h1>
      <p className="text-[13px] text-muted mb-6">Use sua conta Google ou credenciais de acesso.</p>

      {etapa === 'senha' && (
        <>
          <button onClick={handleGoogle} disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-gray-800 font-medium text-[13px] py-2.5 rounded-lg hover:bg-gray-100 transition-colors mb-4 disabled:opacity-60">
            {googleLoading ? <Loader2 size={15} className="animate-spin" /> : (
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
            <div className="flex-1 h-px bg-subtle" /><span className="text-[11px] text-faint font-mono-custom">OU</span><div className="flex-1 h-px bg-subtle" />
          </div>
        </>
      )}

      {info && <p className="text-[12px] text-accent bg-accent/10 border border-accent/20 rounded-lg px-3 py-2 mb-3">{info}</p>}

      {etapa === 'senha' ? (
        <form onSubmit={handleCredentials} className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br"
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors" />
          </div>
          <div>
            <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Senha</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 pr-10 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors" />
              <button type="button" onClick={() => setShowPass((v) => !v)} tabIndex={-1}
                aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-strong transition-colors">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <div className="text-right mt-1.5">
              <Link href="/esqueci-senha" className="text-[11.5px] text-muted hover:text-accent hover:underline transition-colors">Esqueci minha senha</Link>
            </div>
          </div>
          {error && <p className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-brand text-white font-semibold text-[13px] py-2.5 rounded-lg hover:brightness-105 transition-all shadow-sm shadow-accent/20 mt-1 disabled:opacity-60">
            {loading && <Loader2 size={14} className="animate-spin" />} Entrar
          </button>
        </form>
      ) : (
        <form onSubmit={handleOtp} className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">Código de acesso (e-mail)</label>
            <input inputMode="numeric" maxLength={6} required autoFocus value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="000000"
              className="w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[18px] font-mono-custom tracking-[8px] text-center text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors" />
          </div>
          {error && <p className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading || otp.length < 6}
            className="w-full flex items-center justify-center gap-2 bg-gradient-brand text-white font-semibold text-[13px] py-2.5 rounded-lg hover:brightness-105 transition-all shadow-sm shadow-accent/20 mt-1 disabled:opacity-60">
            {loading && <Loader2 size={14} className="animate-spin" />} Confirmar código
          </button>
          <button type="button" onClick={() => { setEtapa('senha'); setError(''); setOtp('') }}
            className="text-[11px] text-muted hover:text-strong transition-colors">← Voltar</button>
        </form>
      )}

      <p className="text-[11px] text-faint text-center mt-5 font-mono-custom">
        <a href="/metodologia" className="text-muted hover:text-accent hover:underline">Fontes e metodologia</a>
        <span className="mx-2 text-subtle">·</span>
        <a href="/privacidade" className="text-muted hover:text-accent hover:underline">Privacidade</a>
      </p>
    </div>
  )
}

/* ───────────────────────── Cadastro + plano + trial ───────────────────────── */
function Criar({ router, planoInicial }: { router: ReturnType<typeof useRouter>; planoInicial?: 'essencial' | 'pro' }) {
  const [f, setF] = useState({ nome: '', email: '', senha: '', empresa: '', cnpj: '', telefone: '' })
  const [plano, setPlano] = useState<'essencial' | 'pro'>(planoInicial ?? 'pro')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const inp = 'w-full bg-bg3 border border-subtle rounded-lg px-3 py-2.5 text-[13px] text-strong placeholder:text-faint focus:outline-none focus:border-accent transition-colors'

  async function handleCriar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (f.nome.trim().length < 2 || !f.email.trim() || f.senha.length < 6) {
      setError('Preencha nome, e-mail e uma senha de ao menos 6 caracteres.'); return
    }
    setLoading(true)
    const res = await fetch('/api/cadastro', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...f, plano }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setLoading(false); setError(d.error ?? 'Não foi possível criar a conta.'); return }
    // loga automaticamente com as credenciais recém-criadas
    const login = await signIn('credentials', { email: f.email.trim().toLowerCase(), password: f.senha, redirect: false })
    setLoading(false)
    if (login?.error) { setError('Conta criada, mas o login falhou. Tente entrar manualmente.'); return }
    // 1º acesso: primeira tela é o Setup da Empresa (estados, produtos…). Após salvar,
    // o cliente cai no Dashboard já filtrado. (Ver src/lib/onboarding.ts)
    router.replace('/perfil?onboarding=1')
  }

  const p = PLANOS.find((x) => x.id === plano)!

  return (
    <div className="bg-bg2 border border-subtle rounded-xl p-7 grid md:grid-cols-[1fr_320px] gap-7">
      {/* Formulário */}
      <div>
        <h1 className="text-[17px] font-heading font-semibold text-strong mb-1">Criar conta · <span className="text-gradient-brand">3 dias grátis</span></h1>
        <p className="text-[13px] text-muted mb-5">Sem cartão agora. Você testa por 3 dias e decide se assina depois.</p>

        <form onSubmit={handleCriar} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Nome completo *"><input className={inp} value={f.nome} onChange={set('nome')} /></Campo>
            <Campo label="E-mail *"><input type="email" className={inp} value={f.email} onChange={set('email')} placeholder="voce@empresa.com.br" /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Senha *">
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} className={inp + ' pr-10'} value={f.senha} onChange={set('senha')} placeholder="mín. 6 caracteres" />
                <button type="button" onClick={() => setShowPass((v) => !v)} tabIndex={-1}
                  aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-strong transition-colors">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Campo>
            <Campo label="Telefone"><input className={inp} value={f.telefone} onChange={set('telefone')} placeholder="(11) 90000-0000" /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Empresa / instituição"><input className={inp} value={f.empresa} onChange={set('empresa')} placeholder="Distribuidora, hospital…" /></Campo>
            <Campo label="CNPJ"><input className={inp} value={f.cnpj} onChange={set('cnpj')} placeholder="00.000.000/0000-00" /></Campo>
          </div>

          {/* Seleção de plano */}
          <div className="mt-1">
            <div className="text-[11px] text-muted font-mono-custom uppercase tracking-wide mb-2">Plano para o teste</div>
            <div className="grid grid-cols-2 gap-2">
              {PLANOS.filter((op) => !op.contato).map((op) => (
                <button type="button" key={op.id} onClick={() => setPlano(op.id as 'essencial' | 'pro')}
                  className={clsx('text-left px-3 py-2.5 rounded-xl border transition-colors',
                    plano === op.id ? 'border-accent bg-accent/10' : 'border-subtle hover:border-muted')}>
                  <div className="flex items-center justify-between">
                    <span className={clsx('text-[13px] font-semibold', plano === op.id ? 'text-accent' : 'text-strong')}>{op.nome}</span>
                    {op.destaque && <span className="text-[9px] font-mono-custom text-accent border border-accent/40 rounded-full px-1.5 py-0.5">popular</span>}
                  </div>
                  <div className="text-[11px] text-faint mt-0.5">{formatarPreco(op.preco)}/{op.ciclo} após o teste</div>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-brand text-white font-semibold text-[13px] py-2.5 rounded-lg hover:brightness-105 transition-all shadow-sm shadow-accent/20 mt-1 disabled:opacity-60">
            {loading && <Loader2 size={14} className="animate-spin" />} Começar teste de 3 dias
          </button>
          <p className="text-[10.5px] text-faint text-center">Ao criar a conta você concorda com nossos termos. Cancele quando quiser.</p>
        </form>
      </div>

      {/* Resumo do plano escolhido */}
      <div className="bg-bg3 border border-subtle rounded-2xl p-5 h-fit">
        <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-1">Você terá acesso a</div>
        <div className="flex items-baseline justify-between mb-3">
          <span className="font-heading font-bold text-[16px] text-strong">{p.nome}</span>
          <span className="text-[12px] text-faint">{formatarPreco(p.preco)}/{p.ciclo}</span>
        </div>
        <ul className="space-y-1.5">
          {p.features.slice(0, 7).map((ft) => (
            <li key={ft} className="flex items-start gap-2 text-[12px] text-muted"><Check size={13} className="text-accent flex-shrink-0 mt-0.5" /> {ft}</li>
          ))}
        </ul>
        <Link href={`/assinar?plano=${p.id}`} className="block text-center text-[11px] text-accent hover:underline mt-4">Prefere já assinar? Ir para o pagamento</Link>
      </div>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] text-muted font-mono-custom uppercase tracking-wide block mb-1.5">{label}</label>{children}</div>
}
