// src/app/inicio/page.tsx — landing PÚBLICA (modernizada — brief-landing-inicio.md).
// Tema claro hospitalar (tokens em globals.css). Estrutura enxuta em blocos, com
// números REAIS do banco, logo oficial, screenshots reais do produto e fundo
// autêntico (mapa da plataforma). Server Component + ISR (revalida a cada hora).

import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { clsx } from 'clsx'
import { ArrowRight, ShieldCheck, Check, Radar, Swords, Flame } from 'lucide-react'
import { PLANOS, formatarPreco } from '@/lib/planos'
import { query } from '@/lib/db'
import { siteUrl } from '@/lib/site'

export const revalidate = 3600 // ISR: números atualizam a cada hora

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'GovHealth AI — Antecipe as licitações de saúde pública',
  description:
    'Da emenda parlamentar ao edital: oportunidades, vencedores e concorrentes das licitações de saúde no Brasil, com dados oficiais e metodologia transparente.',
  openGraph: {
    title: 'GovHealth AI — Antecipe as licitações de saúde pública',
    description:
      'Oportunidades, vencedores e concorrentes das licitações de saúde no Brasil — com dados oficiais e metodologia transparente.',
    type: 'website',
    images: ['/shots/dashboard.png'],
  },
  twitter: { card: 'summary_large_image', images: ['/shots/dashboard.png'] },
}

// Números reais (com fallback truthful medido no banco, caso a query falhe no build).
async function getStats() {
  const fallback = { valor: 52_483_751_556, total: 14_856, munis: 2_865, ufs: 27, ult: '21/06/2026' }
  try {
    const [r] = await query<{ valor: number; total: number; munis: number; ufs: number; ult: string }>(
      `SELECT sum(valor_total_estimado)::float8 AS valor, count(*)::int AS total,
              count(distinct municipio)::int AS munis, count(distinct uf)::int AS ufs,
              to_char(max(data_publicacao),'DD/MM/YYYY') AS ult
         FROM contratacoes WHERE valor_total_estimado >= 10000 AND objeto_compra IS NOT NULL`,
    )
    return r?.total ? r : fallback
  } catch {
    return fallback
  }
}

const num = (n: number) => n.toLocaleString('pt-BR')
const bilhoes = (v: number) => `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`

const RECURSOS = [
  { icon: Radar, titulo: 'Radar pré-edital', texto: 'Emendas, convênios e repasses que viram compra — você chega ao órgão antes do edital.' },
  { icon: Swords, titulo: 'Inteligência de concorrentes', texto: 'Quem vence o quê em cada estado, por item e valor, com ranking de fornecedores.' },
  { icon: Flame, titulo: 'Verba mapeada', texto: 'Radar de verba não executada e preços de referência oficiais para dimensionar a disputa.' },
]

const PASSOS = [
  { n: '01', t: 'Fontes oficiais', d: 'PNCP, Transparência, Compras.gov e CNES — coletados e classificados por mercado de saúde.' },
  { n: '02', t: 'Sinais antes do edital', d: 'Oportunidades, vencedores e concorrentes prontos, filtráveis por estado e categoria.' },
  { n: '03', t: 'Da tela à diretoria', d: 'Alertas, território e exportação Excel/PDF — a inteligência circula na equipe comercial.' },
]

export default async function InicioPage() {
  const s = await getStats()
  const PROVAS = [
    { v: bilhoes(s.valor), l: 'em licitações mapeadas' },
    { v: num(s.total), l: 'contratações de saúde' },
    { v: num(s.munis), l: 'municípios cobertos' },
    { v: `${s.ufs} estados`, l: 'cobertura nacional' },
  ]

  return (
    <div className="min-h-screen bg-bg text-strong">
      {/* Topo */}
      <header className="border-b border-subtle bg-bg2/85 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1080px] mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
          <Image src="/logo-govhealth.png" alt="GovHealth" width={150} height={68} priority className="h-8 w-auto" />
          <div className="flex items-center gap-4">
            <a href="#planos" className="text-[13px] text-muted hover:text-strong transition-colors hidden sm:block">Planos</a>
            <Link href="/metodologia" className="text-[13px] text-muted hover:text-strong transition-colors hidden sm:block">Metodologia</Link>
            <Link href="/login" className="text-[13px] text-muted hover:text-strong transition-colors">Entrar</Link>
            <Link href="/login?criar=1" className="text-[13px] font-semibold text-white bg-gradient-brand hover:brightness-105 px-3.5 py-1.5 rounded-lg transition-all">
              Criar conta
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Bloco 1 — Hero ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-subtle">
          {/* Fundo autêntico: o mapa real da plataforma, com wash + brilhos da marca (azul→teal) */}
          <div aria-hidden className="absolute inset-0 -z-10">
            <Image src="/shots/mapa.png" alt="" fill priority sizes="100vw" className="object-cover object-right opacity-[0.10]" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/95 to-bg/70" />
            <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-accent/10 blur-3xl" />
            <div className="absolute top-1/3 -right-32 w-[460px] h-[460px] rounded-full bg-[#17b8a6]/10 blur-3xl" />
          </div>

          <div className="max-w-[1080px] mx-auto px-6 pt-16 pb-16 grid lg:grid-cols-[1fr_1.05fr] gap-12 items-center">
            <div>
              <div className="reveal inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-strong glass rounded-full px-3 py-1.5 mb-6" style={{ '--d': '0s' } as React.CSSProperties}>
                <ShieldCheck size={12} className="text-teal" /> Fontes 100% oficiais · metodologia pública
              </div>
              <h1 className="reveal font-heading font-bold text-[40px] sm:text-[52px] leading-[1.03] tracking-tight" style={{ '--d': '0.05s' } as React.CSSProperties}>
                Antecipe as licitações de <span className="text-gradient-brand">saúde pública</span> do Brasil
              </h1>
              <p className="reveal text-[17px] text-muted leading-relaxed max-w-[520px] mt-5" style={{ '--d': '0.1s' } as React.CSSProperties}>
                Da emenda parlamentar ao edital: oportunidades, vencedores e concorrentes — com dados oficiais e metodologia transparente.
              </p>
              <div className="reveal flex items-center gap-4 mt-8" style={{ '--d': '0.15s' } as React.CSSProperties}>
                <Link href="/login?criar=1" className="inline-flex items-center gap-2 text-[15px] font-semibold text-white bg-gradient-brand hover:brightness-105 px-6 py-3 rounded-xl transition-all shadow-lg shadow-accent/20">
                  Criar conta · 3 dias grátis <ArrowRight size={16} />
                </Link>
                <Link href="/login" className="text-[14px] text-muted hover:text-strong transition-colors">Já tenho conta</Link>
              </div>
            </div>

            {/* Screenshot real do dashboard, emoldurado + chip de vidro flutuante (ar de monitoramento) */}
            <div className="reveal relative" style={{ '--d': '0.2s' } as React.CSSProperties}>
              <Frame>
                <Image src="/shots/dashboard.png" alt="Dashboard da GovHealth AI com oportunidades reais de saúde"
                  width={1440} height={900} priority className="w-full h-auto" />
              </Frame>
              <div aria-hidden className="glass rounded-2xl px-4 py-3 absolute -bottom-5 -left-5 hidden sm:flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-[#17b8a6]" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal" />
                </span>
                <div className="leading-tight">
                  <div className="font-mono-custom font-semibold text-[15px] text-strong tracking-tight">{bilhoes(s.valor)}</div>
                  <div className="text-[10.5px] text-faint">monitorados agora</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Bloco 2 — Prova por números (faixa fina) ───────────────────── */}
        <section className="border-b border-subtle bg-bg3/60">
          <div className="max-w-[1080px] mx-auto px-6 py-7 grid grid-cols-2 md:grid-cols-4 gap-6">
            {PROVAS.map((p, i) => (
              <div key={p.l} className="reveal text-center md:text-left" style={{ '--d': `${i * 0.06}s` } as React.CSSProperties}>
                <div className="font-mono-custom font-semibold text-[22px] sm:text-[26px] text-gradient-brand tracking-tight">{p.v}</div>
                <div className="text-[12px] text-faint mt-0.5">{p.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bloco 3 — 3 cards de funcionalidade ────────────────────────── */}
        <section className="max-w-[1080px] mx-auto px-6 py-20">
          <div className="grid md:grid-cols-3 gap-5">
            {RECURSOS.map(({ icon: Icon, titulo, texto }, i) => (
              <div key={titulo} className="reveal bg-bg2 border border-subtle rounded-2xl p-6 hover:border-accent/40 hover:shadow-lg hover:shadow-slate-200/50 transition-all" style={{ '--d': `${i * 0.08}s` } as React.CSSProperties}>
                <div className="w-11 h-11 rounded-xl bg-gradient-brand flex items-center justify-center mb-4 shadow-lg shadow-accent/20">
                  <Icon size={20} className="text-white" />
                </div>
                <h3 className="font-heading font-semibold text-[16px] mb-1.5">{titulo}</h3>
                <p className="text-[13.5px] text-muted leading-relaxed">{texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bloco 4 — Como funciona (3 passos) ─────────────────────────── */}
        <section className="border-y border-subtle bg-bg3/60">
          <div className="max-w-[1080px] mx-auto px-6 py-20">
            <p className="text-center text-[12px] font-mono-custom text-faint uppercase tracking-wider mb-10">Como funciona</p>
            <div className="grid md:grid-cols-3 gap-8">
              {PASSOS.map((p, i) => (
                <div key={p.n} className="reveal" style={{ '--d': `${i * 0.08}s` } as React.CSSProperties}>
                  <div className="font-heading font-bold text-[40px] text-gradient-brand leading-none mb-3">{p.n}</div>
                  <h3 className="font-heading font-semibold text-[17px] mb-1.5">{p.t}</h3>
                  <p className="text-[13.5px] text-muted leading-relaxed">{p.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Bloco 5 — Screenshot grande (mapa) ─────────────────────────── */}
        <section className="max-w-[1080px] mx-auto px-6 py-20">
          <div className="reveal">
            <Frame>
              <Image src="/shots/mapa.png" alt="Mapa de inteligência: oportunidades de saúde por todo o Brasil"
                width={1440} height={900} className="w-full h-auto" />
            </Frame>
          </div>
          <p className="text-center text-[13px] text-muted mt-5">
            Cada ponto é uma oportunidade real de saúde, do PNCP — nos {s.ufs} estados. <span className="text-faint">Atualizado em {s.ult}.</span>
          </p>
        </section>

        {/* ── Planos ─────────────────────────────────────────────────────── */}
        <section id="planos" className="border-y border-subtle bg-bg3/60">
          <div className="max-w-[1080px] mx-auto px-6 py-20">
            <h2 className="text-center font-heading font-bold text-[28px] mb-1">Escolha o plano da sua operação</h2>
            <p className="text-center text-[13.5px] text-muted mb-10 max-w-[520px] mx-auto">Mensal, sem fidelidade. 3 dias grátis para testar. Nota fiscal em todos os planos.</p>
            <div className="grid sm:grid-cols-2 gap-5 max-w-[760px] mx-auto">
              {PLANOS.map((p, i) => (
                <div key={p.id} className={clsx('reveal rounded-2xl p-7 border flex flex-col', p.destaque ? 'border-accent shadow-xl shadow-accent/10 bg-gradient-brand-soft' : 'border-subtle bg-bg2')} style={{ '--d': `${i * 0.08}s` } as React.CSSProperties}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-heading font-bold text-[19px]">{p.nome}</h3>
                    {p.destaque && <span className="text-[10px] font-mono-custom text-white bg-gradient-brand px-2 py-0.5 rounded-full font-bold">Mais completo</span>}
                  </div>
                  <p className="text-[12.5px] text-muted mb-4">{p.resumo}</p>
                  <div className="flex items-baseline gap-1 mb-5">
                    <span className="font-heading font-bold text-[34px]">{formatarPreco(p.preco)}</span>
                    <span className="text-[13px] text-faint">/{p.ciclo}</span>
                  </div>
                  <ul className="space-y-2.5 mb-6 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-strong">
                        <Check size={15} className="text-accent flex-shrink-0 mt-0.5" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Link href={`/login?criar=1&plano=${p.id}`}
                    className={clsx('inline-flex items-center justify-center gap-2 text-[14px] font-semibold px-5 py-3 rounded-xl transition-all',
                      p.destaque ? 'bg-gradient-brand text-white hover:brightness-105 shadow-lg shadow-accent/20' : 'bg-bg2 border border-subtle2 text-strong hover:border-accent/50')}>
                    Testar {p.nome} · 3 dias grátis <ArrowRight size={15} />
                  </Link>
                  <Link href={`/assinar?plano=${p.id}`} className="text-center text-[11px] text-faint hover:text-accent mt-2.5">ou assinar direto</Link>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-faint mt-5">Precisa de mais usuários ou plano corporativo? <a href="mailto:contato@techealth.com.br?subject=Plano%20corporativo" className="text-accent hover:underline">Fale com a gente</a>.</p>
          </div>
        </section>

        {/* ── Bloco 6 — CTA final ────────────────────────────────────────── */}
        <section className="max-w-[1080px] mx-auto px-6 py-20">
          <div className="reveal relative overflow-hidden rounded-3xl bg-gradient-brand px-8 py-14 text-center">
            <div aria-hidden className="absolute -top-24 -right-24 w-[360px] h-[360px] rounded-full bg-white/10 blur-3xl" />
            <h2 className="font-heading font-bold text-[26px] sm:text-[30px] text-white relative">Comece antes do próximo edital</h2>
            <p className="text-[14.5px] text-white/85 mt-2 mb-7 relative max-w-[460px] mx-auto">Teste grátis por 3 dias. Sem cartão, sem fidelidade.</p>
            <Link href="/login?criar=1" className="relative inline-flex items-center gap-2 text-[15px] font-semibold text-accent bg-white hover:bg-white/90 px-7 py-3 rounded-xl transition-colors">
              Criar conta · 3 dias grátis <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      {/* Rodapé */}
      <footer className="border-t border-subtle">
        <div className="max-w-[1080px] mx-auto px-6 py-7 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Image src="/logo-govhealth.png" alt="GovHealth" width={120} height={54} className="h-6 w-auto opacity-80" />
            <span className="text-[12px] text-faint font-mono-custom">© {new Date().getFullYear()} · Sales Intelligence</span>
          </div>
          <div className="flex items-center gap-5 text-[12.5px]">
            <Link href="/metodologia" className="text-muted hover:text-accent">Metodologia</Link>
            <Link href="/login" className="text-muted hover:text-accent">Entrar</Link>
            <a href="mailto:contato@techealth.com.br" className="text-muted hover:text-accent">Contato</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** Moldura estilo "janela do produto" para dar sofisticação aos screenshots. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-subtle bg-bg2 shadow-2xl shadow-slate-300/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-subtle bg-bg3/70">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ec6a5e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#f4bf4f]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#61c554]" />
      </div>
      {children}
    </div>
  )
}
