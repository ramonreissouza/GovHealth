// src/app/inicio/page.tsx — landing PÚBLICA (item 1 do TOP10 v2).
// Problema que resolve: o site abria direto no login — invisível para o mercado,
// sem proposta de valor, sem nada indexável. Esta é a face pública: proposta de
// valor + a tese dos 3 pilares + como funciona + confiança (metodologia) + CTA.
// Estática/indexável, fora da área autenticada (ver middleware).

import Link from 'next/link'
import type { Metadata } from 'next'
import { Stethoscope, Radar, Workflow, ArrowRight, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: 'GovHealth AI — Inteligência comercial para licitações de saúde',
  description:
    'A GovHealth AI antecipa oportunidades de saúde pública no Brasil: da emenda ao convênio ao edital. Inteligência pré-edital, análise de vencedores e concorrentes, com fontes oficiais e metodologia transparente.',
  openGraph: {
    title: 'GovHealth AI — Inteligência comercial para licitações de saúde',
    description:
      'Antecipe licitações de saúde pública: emendas, convênios, vencedores e concorrentes — com dados oficiais e metodologia transparente.',
    type: 'website',
  },
}

const PILARES = [
  {
    icon: Stethoscope,
    titulo: 'Especialização em saúde',
    texto: 'Não somos uma ferramenta genérica de licitações. Classificamos o mercado de saúde — medicamentos, equipamentos, insumos, OPME, laboratório — e falamos a língua de quem vende para o SUS.',
  },
  {
    icon: Radar,
    titulo: 'Inteligência pré-edital',
    texto: 'Enquanto os outros mostram o edital publicado, nós olhamos antes: emendas parlamentares, convênios e repasses que viram compra. Você chega no órgão antes do concorrente.',
  },
  {
    icon: Workflow,
    titulo: 'Do sinal à ação',
    texto: 'Oportunidades, vencedores, concorrentes por estado e exportação para Excel/PDF — a inteligência sai da tela e circula na sua diretoria comercial.',
  },
]

const RECURSOS = [
  ['Análise de Vencedores', 'Quem venceu cada licitação de saúde, por item, valor e órgão — com detalhamento do processo.'],
  ['Radar de Concorrência', 'Filtre por categoria e estado, veja o ranking de concorrentes e cada licitação que venceram.'],
  ['Ranking de Fornecedores', 'Os maiores vendedores por categoria, no país ou por estados, com o que cada um vendeu onde.'],
  ['Concorrentes por Estado', 'Quem domina o quê em cada UF, com distribuição por item e entidades beneficiadas.'],
  ['Oportunidades', 'Licitações de saúde em tempo real do PNCP, filtráveis por categoria, estado e situação.'],
  ['Exportação', 'Qualquer tela vira Excel, CSV ou PDF em um clique — pronto para a reunião de diretoria.'],
]

export default function InicioPage() {
  return (
    <div className="min-h-screen bg-bg text-strong">
      {/* Topo */}
      <header className="border-b border-subtle bg-bg2/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1000px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 16 16" fill="none" className="w-5 h-5">
                <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx="8" cy="8" r="2" fill="#000" />
              </svg>
            </div>
            <div>
              <div className="font-heading font-bold text-[15px] leading-none">GovHealth.ai</div>
              <div className="font-mono-custom text-[10px] text-faint mt-0.5 tracking-wide">Sales Intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/metodologia" className="text-[12px] text-muted hover:text-strong transition-colors hidden sm:block">Metodologia</Link>
            <Link href="/login" className="text-[12px] font-semibold text-black bg-accent hover:bg-accent2 px-3.5 py-1.5 rounded-md transition-colors">
              Entrar
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-6">
        {/* Hero */}
        <section className="pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-mono-custom text-accent bg-accent/10 border border-accent/20 rounded-full px-3 py-1 mb-6">
            <ShieldCheck size={12} /> Fontes 100% oficiais · metodologia pública
          </div>
          <h1 className="font-heading font-bold text-[38px] sm:text-[46px] leading-[1.05] max-w-[760px] mx-auto">
            A inteligência que antecipa as licitações de <span className="text-accent">saúde pública</span> no Brasil
          </h1>
          <p className="text-[16px] text-muted leading-relaxed max-w-[620px] mx-auto mt-5">
            Da emenda parlamentar ao convênio ao edital. A GovHealth AI mostra a oportunidade
            antes de virar disputa — e quem são os vencedores e concorrentes de cada mercado.
          </p>
          <div className="flex items-center justify-center gap-3 mt-8 flex-wrap">
            <Link href="/login" className="inline-flex items-center gap-2 text-[14px] font-semibold text-black bg-accent hover:bg-accent2 px-5 py-2.5 rounded-lg transition-colors">
              Entrar na plataforma <ArrowRight size={15} />
            </Link>
            <a href="mailto:contato@govhealth.ai?subject=Solicitação%20de%20acesso%20—%20GovHealth%20AI"
              className="inline-flex items-center gap-2 text-[14px] font-medium text-strong bg-bg3 border border-subtle hover:border-subtle2 px-5 py-2.5 rounded-lg transition-colors">
              Solicitar acesso
            </a>
          </div>
        </section>

        {/* Tese dos 3 pilares */}
        <section className="pb-16">
          <p className="text-center text-[12px] font-mono-custom text-faint uppercase tracking-wider mb-6">
            Por que somos diferentes
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {PILARES.map(({ icon: Icon, titulo, texto }) => (
              <div key={titulo} className="bg-bg2 border border-subtle rounded-xl p-5">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center mb-3">
                  <Icon size={18} className="text-accent" />
                </div>
                <h3 className="font-heading font-semibold text-[15px] mb-1.5">{titulo}</h3>
                <p className="text-[13px] text-muted leading-relaxed">{texto}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-[13px] text-muted mt-6 max-w-[680px] mx-auto">
            Ninguém no Brasil combina os três: <strong className="text-strong">especialização em saúde</strong>,{' '}
            <strong className="text-strong">inteligência pré-edital</strong> e{' '}
            <strong className="text-strong">workflow comercial</strong>. Quem junta, vira referência.
          </p>
        </section>

        {/* Recursos */}
        <section className="pb-16">
          <p className="text-center text-[12px] font-mono-custom text-faint uppercase tracking-wider mb-6">
            O que você encontra dentro
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {RECURSOS.map(([titulo, texto]) => (
              <div key={titulo} className="bg-bg2 border border-subtle rounded-xl p-4">
                <h3 className="font-heading font-semibold text-[14px] mb-1">{titulo}</h3>
                <p className="text-[12px] text-muted leading-snug">{texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Confiança */}
        <section className="pb-16">
          <div className="bg-bg2 border border-subtle rounded-2xl p-8 text-center">
            <ShieldCheck size={28} className="text-accent mx-auto mb-3" />
            <h2 className="font-heading font-semibold text-[20px] mb-2">Transparência é o produto</h2>
            <p className="text-[14px] text-muted leading-relaxed max-w-[600px] mx-auto">
              Cada dado vem de fonte oficial do governo — PNCP, Portal da Transparência, Compras.gov,
              CNES — e o momento real da coleta fica visível na plataforma. Publicamos abertamente de
              onde vêm os dados e o que não garantimos.
            </p>
            <Link href="/metodologia" className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline mt-4">
              Ver fontes e metodologia <ArrowRight size={14} />
            </Link>
          </div>
        </section>
      </main>

      {/* Rodapé */}
      <footer className="border-t border-subtle">
        <div className="max-w-[1000px] mx-auto px-6 py-6 flex items-center justify-between gap-4 flex-wrap">
          <span className="text-[12px] text-faint font-mono-custom">© {new Date().getFullYear()} GovHealth AI · Sales Intelligence</span>
          <div className="flex items-center gap-4 text-[12px]">
            <Link href="/metodologia" className="text-muted hover:text-accent">Metodologia</Link>
            <Link href="/login" className="text-muted hover:text-accent">Entrar</Link>
            <a href="mailto:contato@govhealth.ai" className="text-muted hover:text-accent">Contato</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
