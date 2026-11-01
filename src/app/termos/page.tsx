// src/app/termos/page.tsx — Termos de Uso. Página PÚBLICA e estática (ver ROTAS_PUBLICAS
// no middleware): um contrato que só abre depois do login não vale como contrato.
//
// O texto mora em src/components/legal/termos-conteudo.tsx, porque o cadastro mostra o
// MESMO texto numa janela antes do "Li e estou de acordo".

import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { CONTROLADOR_RAZAO_SOCIAL, CONTROLADOR_CNPJ, CONTATO_EMAIL, TERMOS_VERSAO } from '@/lib/empresa-legal'
import { SECOES_TERMOS, TERMOS_ATUALIZADO_EM } from '@/components/legal/termos-conteudo'

export const metadata: Metadata = {
  title: 'Termos de Uso — GovHealth AI',
  description:
    'Condições de uso da plataforma GovHealth AI: objeto, conta e acesso, planos e pagamento, natureza dos dados de fontes públicas, uso aceitável, confidencialidade, proteção de dados (LGPD) e responsabilidades.',
}

export default function TermosPage() {
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
            <span className="font-mono-custom text-[10px] text-faint tracking-wide hidden sm:inline">Termos de Uso</span>
          </div>
          <Link href="/login" className="text-[12px] font-semibold text-white bg-gradient-brand hover:brightness-105 px-3 py-1.5 rounded-md transition-all">
            Entrar na plataforma
          </Link>
        </div>
      </header>

      <main className="max-w-[880px] mx-auto px-6 py-10">
        <h1 className="font-heading font-bold text-[26px] leading-tight mb-1">Termos de <span className="text-gradient-brand">Uso</span></h1>
        <p className="text-[11px] text-faint font-mono-custom mb-8">Última atualização: {TERMOS_ATUALIZADO_EM} · versão {TERMOS_VERSAO} · {CONTROLADOR_RAZAO_SOCIAL} · CNPJ {CONTROLADOR_CNPJ}</p>

        <div className="space-y-8">
          {SECOES_TERMOS.map((s) => (
            <section key={s.titulo}>
              <h2 className="font-heading font-semibold text-[17px] mb-2">{s.titulo}</h2>
              <div className="text-[13px] text-muted leading-relaxed">{s.conteudo}</div>
            </section>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-subtle text-[12px] text-faint">
          Dúvidas sobre estes Termos?{' '}
          <a href={`mailto:${CONTATO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{CONTATO_EMAIL}</a>.
          {' · '}
          <Link href="/privacidade" className="text-accent hover:underline">Política de Privacidade</Link>
          {' · '}
          <Link href="/metodologia" className="text-accent hover:underline">Fontes e metodologia</Link>
        </div>
      </main>
    </div>
  )
}
