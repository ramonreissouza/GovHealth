'use client'
// src/app/manual/page.tsx

import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import {
  Flame, TrendingUp, Database, Filter, Search, Zap,
  Calendar, MapPin, ArrowRight, Info, CheckCircle, Clock,
} from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function Section({ id, title, icon: Icon, children }: {
  id: string
  title: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Icon size={14} className="text-accent" />
        </div>
        <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-bg2 border border-subtle rounded-xl p-5', className)}>
      {children}
    </div>
  )
}

function ScoreTier({ score, label, color, description }: {
  score: string; label: string; color: string; description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={clsx(
        'inline-flex items-center justify-center w-10 h-10 rounded-lg font-mono-custom text-[13px] font-bold flex-shrink-0',
        color,
      )}>
        {score}
      </span>
      <div>
        <div className="text-[13px] font-semibold text-strong">{label}</div>
        <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

// ── TOC ──────────────────────────────────────────────────────────────────────

const TOC = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'fontes', label: 'Fontes de dados' },
  { id: 'score', label: 'Opportunity Score' },
  { id: 'sub-scores', label: 'Sub-scores' },
  { id: 'status', label: 'Status e urgência' },
  { id: 'categorias', label: 'Categorias' },
  { id: 'filtros', label: 'Filtros e busca' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManualPage() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Manual do Usuário" subtitle="Como a plataforma funciona" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">
          <div className="max-w-4xl mx-auto flex gap-8">

            {/* TOC sidebar */}
            <aside className="hidden lg:block w-44 flex-shrink-0">
              <div className="sticky top-0 space-y-1">
                <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-3">Nesta página</div>
                {TOC.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="block text-[12px] text-muted hover:text-strong transition-colors py-0.5"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </aside>

            {/* Content */}
            <div className="flex-1 space-y-10 min-w-0">

              {/* ── Visão geral ── */}
              <Section id="visao-geral" title="Visão geral" icon={Info}>
                <Card>
                  <p className="text-[13px] text-muted leading-relaxed mb-4">
                    O <span className="text-strong font-semibold">GovHealth.ai</span> é uma plataforma de <em className="text-accent not-italic">Sales Intelligence</em> para o mercado de equipamentos hospitalares no Brasil. Ela monitora automaticamente editais públicos e convênios federais de saúde, calcula a probabilidade de abertura de novas licitações e prioriza as oportunidades com maior potencial comercial.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { icon: Database, label: 'Dados públicos', desc: 'PNCP e Portal da Transparência, atualizados a cada 30 min' },
                      { icon: Zap, label: 'Score automático', desc: 'Algoritmo que classifica cada oportunidade de 0 a 100' },
                      { icon: TrendingUp, label: 'Inteligência de ciclo', desc: 'Histórico 2023–2025 revela padrões de compra por órgão' },
                    ].map(({ icon: Icon, label, desc }) => (
                      <div key={label} className="flex gap-3 p-3 bg-bg3 rounded-lg">
                        <Icon size={14} className="text-accent mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-[12px] font-semibold text-strong">{label}</div>
                          <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </Section>

              {/* ── Fontes ── */}
              <Section id="fontes" title="Fontes de dados" icon={Database}>
                <div className="space-y-3">
                  <Card>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-blue/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-mono-custom font-bold text-brand-blue">PNCP</span>
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-strong mb-1">Portal Nacional de Contratações Públicas</div>
                        <p className="text-[12px] text-muted leading-relaxed">
                          API pública (sem autenticação). Cobre licitações publicadas de <strong className="text-strong">2023 a 2025</strong> — Pregão Eletrônico (modalidade 6) e Dispensa (modalidade 8). A plataforma busca 15 janelas de tempo em paralelo para maximizar cobertura sem timeout.
                        </p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {['Editais abertos', 'Editais encerrados', 'Histórico de compras', 'Valores homologados'].map((t) => (
                            <span key={t} className="text-[10px] font-mono-custom px-2 py-0.5 bg-bg3 border border-subtle2 rounded-full text-muted">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-mono-custom font-bold text-emerald-400">TGov</span>
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-strong mb-1">Portal da Transparência — TransfereGov</div>
                        <p className="text-[12px] text-muted leading-relaxed">
                          Requer <code className="text-accent bg-bg3 px-1 rounded">PORTAL_TRANSPARENCIA_API_KEY</code> no <code className="text-accent bg-bg3 px-1 rounded">.env.local</code>. Fornece convênios federais de saúde ativos por UF. Um convênio com alta execução orçamentária e vencimento próximo é forte indicador de licitação iminente.
                        </p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {['Convênios ativos', '% verba executada', 'Data de vencimento', 'Emendas parlamentares'].map((t) => (
                            <span key={t} className="text-[10px] font-mono-custom px-2 py-0.5 bg-bg3 border border-subtle2 rounded-full text-muted">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </Section>

              {/* ── Score ── */}
              <Section id="score" title="Opportunity Score (0–100)" icon={Flame}>
                <Card className="mb-3">
                  <p className="text-[13px] text-muted leading-relaxed mb-5">
                    Cada oportunidade recebe uma pontuação de <strong className="text-strong">0 a 100</strong> que representa a probabilidade e a urgência de aquele órgão abrir (ou reabrir) uma licitação de equipamentos de saúde. Quanto maior o score, mais prioritário é o contato comercial.
                  </p>

                  <div className="space-y-4">
                    <ScoreTier
                      score="95"
                      label="Edital aberto — encerra em ≤ 7 dias"
                      color="score-hot"
                      description="Máxima urgência. O edital está publicado e o prazo de envio de propostas encerra em menos de uma semana. Acionar equipe comercial imediatamente."
                    />
                    <ScoreTier
                      score="88"
                      label="Edital aberto — encerra em ≤ 30 dias"
                      color="score-hot"
                      description="Alta prioridade. Tempo hábil para preparar proposta técnica e comercial. Iniciar processo de habilitação se necessário."
                    />
                    <ScoreTier
                      score="80"
                      label="Edital aberto — prazo longo"
                      color="score-hot"
                      description="Edital publicado com prazo superior a 30 dias. Monitorar e preparar proposta com calma."
                    />
                    <ScoreTier
                      score="75"
                      label="Histórico recente — ciclo próximo (2025)"
                      color="score-warm"
                      description="Órgão comprou em 2025. Próximo ciclo estimado para 2028–2029. Score alto por valor elevado do contrato anterior."
                    />
                    <ScoreTier
                      score="60"
                      label="Histórico 2024 — ciclo médio"
                      color="score-warm"
                      description="Compra registrada em 2024. Inclua no funil de monitoramento ativo. Próximo ciclo estimado para 2027."
                    />
                    <ScoreTier
                      score="50"
                      label="Histórico 2023 — baixa urgência"
                      color="score-cold"
                      description="Compra mais antiga. Útil como inteligência de mercado para mapear o órgão. Próximo ciclo estimado para 2026."
                    />
                  </div>
                </Card>

                {/* Score formula */}
                <Card>
                  <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider mb-3">Fórmula — oportunidades históricas</div>
                  <div className="bg-bg3 rounded-lg p-3 font-mono-custom text-[12px] text-muted space-y-1">
                    <div><span className="text-accent">score</span> = min(85, 45 + scoreValor + scoreRecência)</div>
                    <div className="border-t border-subtle mt-2 pt-2 space-y-0.5">
                      <div><span className="text-strong">scoreValor</span>: ≥R$5M→+20 · ≥R$1M→+14 · ≥R$500K→+8 · ≥R$100K→+4 · outros→+2</div>
                      <div><span className="text-strong">scoreRecência</span>: 2025→+25 · 2024→+15 · 2023→+5</div>
                    </div>
                  </div>
                </Card>
              </Section>

              {/* ── Sub-scores ── */}
              <Section id="sub-scores" title="Sub-scores (oportunidades de convênio)" icon={TrendingUp}>
                <Card>
                  <p className="text-[13px] text-muted leading-relaxed mb-4">
                    Para oportunidades geradas a partir de convênios do TransfereGov, o score é decomposto em quatro dimensões — visíveis ao passar o mouse sobre o badge de score ou ao expandir o card.
                  </p>
                  <div className="space-y-4">
                    {[
                      {
                        name: 'Convênio (peso 30%)',
                        color: 'text-accent',
                        items: [
                          'Percentual executado (≥80% = +40 pts)',
                          'Valor total do convênio (≥R$5M = +25 pts)',
                          'Dias até vencimento (≤60 dias = +25 pts)',
                          'Verba já liberada (≥80% = +10 pts)',
                        ],
                      },
                      {
                        name: 'Histórico (peso 28%)',
                        color: 'text-brand-blue',
                        items: [
                          'Idade do equipamento vs. ciclo médio da categoria',
                          'Anos desde a última compra registrada',
                          'Sazonalidade: abril–agosto têm mais licitações de saúde',
                        ],
                      },
                      {
                        name: 'Órgão (peso 22%)',
                        color: 'text-brand-purple',
                        items: [
                          'Emenda parlamentar aprovada (+50 pts — sinal fortíssimo)',
                          'Porte do hospital por número de leitos',
                          'Tipo de gestão: federal > estadual > municipal',
                        ],
                      },
                      {
                        name: 'Competição (peso 20%)',
                        color: 'text-amber',
                        items: [
                          'Concorrente líder perdeu último pregão (+40 pts)',
                          'Share do líder regional (<30% = mercado aberto)',
                          'Número de concorrentes históricos (≤2 = baixa disputa)',
                        ],
                      },
                    ].map(({ name, color, items }) => (
                      <div key={name}>
                        <div className={clsx('text-[12px] font-semibold mb-1.5', color)}>{name}</div>
                        <ul className="space-y-1">
                          {items.map((item) => (
                            <li key={item} className="flex items-start gap-2 text-[12px] text-muted">
                              <ArrowRight size={10} className="text-faint mt-1 flex-shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Card>
              </Section>

              {/* ── Status e urgência ── */}
              <Section id="status" title="Status e urgência" icon={Clock}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Card>
                    <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider mb-3">Status do edital (PNCP)</div>
                    <div className="space-y-2">
                      {[
                        { label: 'Divulgada', cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', desc: 'Edital publicado e em recebimento de propostas' },
                        { label: 'Suspensa', cls: 'bg-amber/15 text-amber border border-amber/30', desc: 'Licitação temporariamente suspensa por recurso ou decisão judicial' },
                        { label: 'Cancelada', cls: 'bg-red/15 text-red border border-red/30', desc: 'Processo cancelado definitivamente' },
                        { label: 'Encerrada', cls: 'bg-bg4 text-faint border border-subtle2', desc: 'Prazo expirado ou contrato já homologado' },
                      ].map(({ label, cls, desc }) => (
                        <div key={label} className="flex items-center gap-2.5">
                          <span className={clsx('text-[9px] font-mono-custom px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0', cls)}>{label}</span>
                          <span className="text-[11px] text-muted">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card>
                    <div className="text-[11px] font-mono-custom text-faint uppercase tracking-wider mb-3">Urgência comercial</div>
                    <div className="space-y-2">
                      {[
                        { label: 'URGENTE', cls: 'text-brand-red', desc: 'Janela ≤30 dias e score ≥70. Acionar equipe agora.' },
                        { label: 'ALTA', cls: 'text-amber', desc: 'Janela ≤60 dias ou score ≥80. Iniciar proposta.' },
                        { label: 'MÉDIA', cls: 'text-brand-blue', desc: 'Janela ≤90 dias ou score ≥65. Monitorar de perto.' },
                        { label: 'NORMAL', cls: 'text-faint', desc: 'Ciclo longo. Manter no funil para maturação.' },
                      ].map(({ label, cls, desc }) => (
                        <div key={label} className="flex items-center gap-2.5">
                          <span className={clsx('text-[10px] font-mono-custom font-bold w-14 flex-shrink-0', cls)}>{label}</span>
                          <span className="text-[11px] text-muted">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </Section>

              {/* ── Categorias ── */}
              <Section id="categorias" title="Categorias de equipamento" icon={Zap}>
                <Card>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Imagem', color: 'tag-blue', keywords: 'Tomógrafo, Ressonância, Ultrassom, Raio-X, Mamógrafo, Radiologia' },
                      { label: 'UTI', color: 'tag-red', keywords: 'Ventilador, Respirador, Monitor multiparamétrico, Desfibrilador, Bomba de infusão, Oxímetro' },
                      { label: 'Lab', color: 'tag-amber', keywords: 'Analisador hematológico, Hemoterapia, Bioquímica, Laboratório clínico' },
                      { label: 'Cirurgia', color: 'tag-purple', keywords: 'Mesa cirúrgica, Bisturi, Laparoscopia, Endoscopia' },
                      { label: 'Oncologia', color: 'tag-green', keywords: 'Quimioterapia, Radioterapia, Acelerador linear' },
                      { label: 'Outros', color: 'bg-bg4 text-faint', keywords: 'Equipamentos hospitalares em geral não enquadrados nas categorias acima' },
                    ].map(({ label, color, keywords }) => (
                      <div key={label}>
                        <span className={clsx('text-[10px] font-mono-custom px-2 py-0.5 rounded-full uppercase tracking-wide', color)}>{label}</span>
                        <p className="text-[11px] text-muted mt-1.5 leading-relaxed">{keywords}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </Section>

              {/* ── Filtros ── */}
              <Section id="filtros" title="Filtros e busca" icon={Filter}>
                <Card>
                  <div className="space-y-4">
                    {[
                      {
                        icon: Search,
                        label: 'Busca textual',
                        desc: 'Pesquisa simultânea em nome do hospital, município, UF, CNPJ (qualquer formato), número PNCP e descrição do objeto. Case-insensitive.',
                      },
                      {
                        icon: TrendingUp,
                        label: 'Score mínimo',
                        desc: 'Filtra para mostrar apenas oportunidades acima do limiar selecionado (50, 70 ou 80). Use "80+" para focar em editais abertos ou histórico de alto valor.',
                      },
                      {
                        icon: Zap,
                        label: 'Categoria',
                        desc: 'Restringe ao tipo de equipamento. O filtro é aplicado no servidor — reduz volume de dados retornados e acelera a busca.',
                      },
                      {
                        icon: MapPin,
                        label: 'UF',
                        desc: 'Filtra por estado. Quando combinado com a fonte TransfereGov, também restringe os convênios buscados — relevante para times regionais.',
                      },
                      {
                        icon: Calendar,
                        label: 'Dias restantes (badge verde)',
                        desc: 'Aparece automaticamente quando o edital ainda está aberto. Clique no card para ver a data exata de encerramento.',
                      },
                    ].map(({ icon: Icon, label, desc }) => (
                      <div key={label} className="flex gap-3">
                        <Icon size={13} className="text-accent mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-[12px] font-semibold text-strong">{label}</div>
                          <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Tips */}
                <div className="mt-3 p-4 bg-accent/5 border border-accent/20 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={13} className="text-accent" />
                    <span className="text-[12px] font-semibold text-strong">Dicas de uso</span>
                  </div>
                  <ul className="space-y-1.5 text-[12px] text-muted">
                    <li className="flex gap-2"><ArrowRight size={10} className="text-faint mt-1 flex-shrink-0" />Passe o mouse sobre o <strong className="text-strong">badge de score</strong> para ver a composição e a razão do valor.</li>
                    <li className="flex gap-2"><ArrowRight size={10} className="text-faint mt-1 flex-shrink-0" />Clique em qualquer linha para <strong className="text-strong">expandir os detalhes</strong>: objeto completo, link do edital, datas e sub-scores.</li>
                    <li className="flex gap-2"><ArrowRight size={10} className="text-faint mt-1 flex-shrink-0" />Editais com badge <strong className="text-emerald-400">Xd restantes</strong> estão ativos — propostas ainda podem ser enviadas.</li>
                    <li className="flex gap-2"><ArrowRight size={10} className="text-faint mt-1 flex-shrink-0" />Históricos <strong className="text-strong">Encerrados</strong> representam inteligência de ciclo: o órgão já comprou aquele tipo de equipamento e tende a repetir.</li>
                  </ul>
                </div>
              </Section>

            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
