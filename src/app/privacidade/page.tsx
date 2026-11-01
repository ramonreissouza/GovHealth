// src/app/privacidade/page.tsx — Política de Privacidade (LGPD). Página PÚBLICA e estática
// (ver ROTAS_PUBLICAS no middleware).
//
// O texto mora em src/components/legal/privacidade-conteudo.tsx, porque o cadastro mostra
// o MESMO texto numa janela antes do "Li e estou de acordo".
//
// ⚠️ Este texto não substitui validação jurídica.

import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { DPO_EMAIL, PRIVACIDADE_VERSAO } from '@/lib/empresa-legal'
import { SECOES_PRIVACIDADE, PRIVACIDADE_ATUALIZADO_EM } from '@/components/legal/privacidade-conteudo'

export const metadata: Metadata = {
  title: 'Política de Privacidade — GovHealth AI',
  description:
    'Como a GovHealth AI trata dados pessoais: dados coletados, finalidades e base legal (LGPD), compartilhamento, direitos do titular, incidentes e segurança.',
}

export default function PrivacidadePage() {
  return (
    <div className="relative min-h-screen bg-bg text-strong overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 w-[440px] h-[440px] rounded-full bg-accent/[0.07] blur-3xl" />
        <div className="absolute top-1/2 -right-40 w-[460px] h-[460px] rounded-full bg-[#17b8a6]/[0.07] blur-3xl" />
      </div>

      <header className="border-b border-subtle bg-bg2/85 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[880px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/logo-govhealth.png" alt="GovHealth" width={150} height={68} priority className="h-8 w-auto" />
            <span className="font-mono-custom text-[10px] text-faint tracking-wide hidden sm:inline">Privacidade</span>
          </div>
          <Link href="/login" className="text-[12px] font-semibold text-white bg-gradient-brand hover:brightness-105 px-3 py-1.5 rounded-md transition-all">
            Entrar na plataforma
          </Link>
        </div>
      </header>

      <main className="max-w-[880px] mx-auto px-6 py-10">
        <h1 className="font-heading font-bold text-[26px] leading-tight mb-1">Política de <span className="text-gradient-brand">Privacidade</span></h1>
        <p className="text-[11px] text-faint font-mono-custom mb-8">Última atualização: {PRIVACIDADE_ATUALIZADO_EM} · versão {PRIVACIDADE_VERSAO} · em conformidade com a LGPD (Lei nº 13.709/2018)</p>

        <div className="space-y-8">
          {SECOES_PRIVACIDADE.map((s) => (
            <section key={s.titulo}>
              <h2 className="font-heading font-semibold text-[17px] mb-2">{s.titulo}</h2>
              <div className="text-[13px] text-muted leading-relaxed">{s.conteudo}</div>
            </section>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-subtle text-[12px] text-faint">
          Dúvidas sobre seus dados? Fale com nosso Encarregado:{' '}
          <a href={`mailto:${DPO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{DPO_EMAIL}</a>.
          {' · '}
          <Link href="/metodologia" className="text-accent hover:underline">Fontes e metodologia</Link>
        </div>
      </main>
    </div>
  )
}
