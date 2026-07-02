// src/app/metodologia/page.tsx — página PÚBLICA de fontes e metodologia (item 7 do TOP10 v2).
// Transparência como diferencial de confiança: expõe de onde vêm os dados, com que
// frequência atualizam e quais as limitações conhecidas. Página estática, indexável,
// fora da área autenticada (ver matcher do middleware).

import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Fontes e Metodologia — GovHealth AI',
  description:
    'De onde vêm os dados da GovHealth AI: PNCP, Compras.gov, Portal da Transparência, CNES e Diário Oficial. Frequência de atualização e limitações conhecidas, com transparência.',
}

interface Fonte {
  nome: string
  orgao: string
  fornece: string
  frequencia: string
  url: string
}

const FONTES: Fonte[] = [
  {
    nome: 'PNCP — Portal Nacional de Contratações Públicas',
    orgao: 'Governo Federal / Ministério da Gestão',
    fornece: 'Editais, itens, modalidades e resultados homologados (vencedores, valores, fornecedores) das contratações públicas de saúde.',
    frequencia: 'Coleta incremental contínua; refresh quinzenal agendado.',
    url: 'https://pncp.gov.br',
  },
  {
    nome: 'Compras.gov.br — Dados Abertos',
    orgao: 'Governo Federal',
    fornece: 'Preços praticados e catálogo de materiais (CATMAT) para referência de valores.',
    frequencia: 'Consulta sob demanda à API oficial.',
    url: 'https://dadosabertos.compras.gov.br',
  },
  {
    nome: 'Portal da Transparência / TransfereGov',
    orgao: 'Controladoria-Geral da União (CGU) / Governo Federal',
    fornece: 'Emendas parlamentares, convênios e repasses para a saúde (inteligência pré-edital).',
    frequencia: 'Consulta sob demanda à API oficial.',
    url: 'https://portaldatransparencia.gov.br',
  },
  {
    nome: 'CNES — Cadastro Nacional de Estabelecimentos de Saúde',
    orgao: 'Ministério da Saúde / DATASUS',
    fornece: 'Estabelecimentos de saúde (hospitais, UPAs, secretarias) usados para enriquecer órgãos e territórios.',
    frequencia: 'Consulta sob demanda à API oficial.',
    url: 'https://cnes.datasus.gov.br',
  },
  {
    nome: 'DOU — Diário Oficial da União',
    orgao: 'Imprensa Nacional',
    fornece: 'Avisos e publicações oficiais relacionados a licitações.',
    frequencia: 'Consulta sob demanda.',
    url: 'https://www.in.gov.br',
  },
]

const LIMITACOES = [
  'Só refletimos o que os órgãos publicam oficialmente. Se uma contratação não foi publicada no PNCP, ela não aparece aqui.',
  'Resultados de vencedores só existem quando o item foi homologado no PNCP (situação 2). Itens desertos, fracassados ou ainda em disputa não têm vencedor registrado.',
  'A cobertura histórica está em expansão contínua (por UF, modalidade e período). Recortes com pouco dado indicam coleta ainda em andamento, não ausência de mercado.',
  'Preços de referência são indicativos e dependem da qualidade do cadastro na fonte oficial.',
  'Não inventamos dados: quando uma informação não está disponível na fonte, ela aparece como “—” ou vazia, nunca preenchida por estimativa.',
]

export default function MetodologiaPage() {
  return (
    <div className="min-h-screen bg-bg text-strong">
      {/* Topo */}
      <header className="border-b border-subtle bg-bg2">
        <div className="max-w-[880px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
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
          <Link href="/login" className="text-[12px] font-semibold text-black bg-accent hover:bg-accent2 px-3 py-1.5 rounded-md transition-colors">
            Entrar na plataforma
          </Link>
        </div>
      </header>

      <main className="max-w-[880px] mx-auto px-6 py-10">
        <h1 className="font-heading font-bold text-[26px] leading-tight mb-2">Fontes e metodologia</h1>
        <p className="text-[14px] text-muted leading-relaxed mb-8 max-w-[640px]">
          A GovHealth AI é uma plataforma de inteligência comercial para o mercado de saúde pública.
          Nossas análises embasam propostas de alto valor — por isso a origem de cada dado é pública e
          rastreável. Trabalhamos exclusivamente com <strong className="text-strong">fontes oficiais do
          governo brasileiro</strong>, sem dados privados ou estimados.
        </p>

        {/* Fontes */}
        <section className="mb-10">
          <h2 className="font-heading font-semibold text-[18px] mb-4">De onde vêm os dados</h2>
          <div className="space-y-3">
            {FONTES.map((f) => (
              <div key={f.nome} className="bg-bg2 border border-subtle rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-strong">{f.nome}</div>
                    <div className="text-[11px] text-faint font-mono-custom mt-0.5">{f.orgao}</div>
                  </div>
                  <a href={f.url} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-accent hover:underline font-mono-custom flex-shrink-0">
                    {f.url.replace('https://', '')} ↗
                  </a>
                </div>
                <p className="text-[13px] text-muted leading-snug mt-2">{f.fornece}</p>
                <div className="text-[11px] text-faint mt-2">
                  <span className="font-mono-custom uppercase tracking-wide">Atualização: </span>{f.frequencia}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Como coletamos */}
        <section className="mb-10">
          <h2 className="font-heading font-semibold text-[18px] mb-3">Como coletamos e consolidamos</h2>
          <div className="bg-bg2 border border-subtle rounded-xl p-5 text-[13px] text-muted leading-relaxed space-y-2">
            <p>
              Um pipeline de coleta (ETL) percorre as contratações de saúde no PNCP, desce até os itens de
              cada compra e, para os itens homologados, registra o resultado: quem venceu, por quanto e para
              qual órgão. Tudo é persistido em banco e atualizado de forma incremental, com checkpoint para
              retomar de onde parou.
            </p>
            <p>
              O selo de atualização exibido dentro da plataforma reflete o momento <strong className="text-strong">real</strong> da
              última coleta — não a hora em que você abriu a tela.
            </p>
          </div>
        </section>

        {/* Limitações */}
        <section className="mb-10">
          <h2 className="font-heading font-semibold text-[18px] mb-3">Limitações conhecidas</h2>
          <p className="text-[13px] text-muted mb-3">
            Transparência inclui admitir o que a plataforma <em>não</em> garante:
          </p>
          <ul className="space-y-2">
            {LIMITACOES.map((l, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] text-muted leading-snug">
                <span className="text-accent flex-shrink-0 mt-0.5">•</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="border-t border-subtle pt-6 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-[12px] text-faint font-mono-custom">
            Dúvidas sobre metodologia? <a href="mailto:contato@govhealth.ai?subject=Metodologia%20—%20GovHealth%20AI" className="text-accent hover:underline">contato@govhealth.ai</a>
          </p>
          <Link href="/login" className="text-[12px] text-accent hover:underline">Entrar na plataforma →</Link>
        </div>
      </main>
    </div>
  )
}
