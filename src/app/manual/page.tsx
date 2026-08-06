'use client'
// src/app/manual/page.tsx

import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { clsx } from 'clsx'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { temAcessoPro } from '@/lib/plano-gating'
import {
  Flame, TrendingUp, Database, Filter, Search, Zap,
  Calendar, MapPin, ArrowRight, Info, CheckCircle, Clock,
  LayoutDashboard, Boxes, Users, Kanban, CalendarClock, Map as MapIcon,
  FileText, Trophy, Building2, Wallet, DollarSign, Bell, Crown, Lock, LayoutGrid,
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

const TOC_BASE = [
  { id: 'visao-geral', label: 'Visão geral' },
  { id: 'funcionalidades', label: 'Funcionalidades' },
  { id: 'fontes', label: 'Fontes de dados' },
  { id: 'score', label: 'Opportunity Score' },
  { id: 'sub-scores', label: 'Sub-scores & CAPAG' },
  { id: 'status', label: 'Status e urgência' },
  { id: 'categorias', label: 'Categorias' },
  { id: 'filtros', label: 'Filtros e busca' },
]

// Módulos da plataforma, marcados por plano. `pro: true` espelha ROTAS_PRO
// (plano-gating.ts): esses só aparecem no manual de quem tem acesso Pro.
interface Modulo { label: string; icon: React.ElementType; desc: string; pro: boolean; passos: string[]; valor: string }
const MODULOS: Modulo[] = [
  {
    label: 'Dashboard', icon: LayoutDashboard, pro: false,
    desc: 'Visão geral do dia: KPIs, oportunidades quentes e alertas prioritários.',
    passos: [
      'Ao entrar, leia os KPIs do topo: oportunidades quentes, valor em jogo e prazos que vencem.',
      'Clique em qualquer KPI para abrir a lista filtrada correspondente (o número não é decorativo).',
      'Confira o bloco de alertas do dia e abra os que interessam.',
    ],
    valor: 'Use como ponto de partida diário — os números levam direto à ação, sem precisar garimpar.',
  },
  {
    label: 'Licitações', icon: Zap, pro: false,
    desc: 'Busca de editais de saúde com Opportunity Score, filtros por UF, categoria e prazo.',
    passos: [
      'Digite o equipamento na busca (ex.: "tomógrafo") — ela ignora acento e maiúscula.',
      'Refine por UF, categoria e score mínimo (50 / 70 / 80).',
      'Passe o mouse no badge de score para entender por que ele é alto.',
      'Clique numa linha para ver objeto, prazo, link do edital no PNCP e sub-scores.',
    ],
    valor: 'Priorize score ≥70 com prazo curto: é onde há chance real e urgência comercial.',
  },
  {
    label: 'Maior Atuação', icon: TrendingUp, pro: false,
    desc: 'Quem mais compra: ranking de órgãos por valor, UF, tipo de fornecimento e categoria.',
    passos: [
      'No painel esquerdo, filtre por Ano, Tipo de fornecimento (equipamento, medicamento, acessório…), Categoria clínica e Situação.',
      'Na barra superior, restrinja a UF.',
      'Leia a coluna Valor (a lista já vem ordenada) para ver quem mais compra.',
      'Clique numa linha para abrir os itens da licitação e o preço de referência.',
    ],
    valor: 'Monte sua lista de alvos: os órgãos que mais compram o seu tipo de produto na sua região.',
  },
  {
    label: 'Vencedores', icon: Trophy, pro: false,
    desc: 'Resultados homologados — quem venceu, por qual preço e em qual região.',
    passos: [
      'Filtre por UF, empresa e período.',
      'Veja, item a item, quem venceu e o valor homologado.',
      'Compare o preço vencedor com o seu preço-alvo.',
    ],
    valor: 'Descubra a que preço o concorrente ganhou para calibrar a sua próxima proposta.',
  },
  {
    label: 'Fornecedores', icon: Building2, pro: false,
    desc: 'Ranking de concorrentes por valor homologado, com filtro por estado.',
    passos: [
      'Abra o ranking de fornecedores por valor homologado.',
      'Filtre por estado para ver o líder regional.',
      'Clique num fornecedor para abrir o histórico de vitórias dele.',
    ],
    valor: 'Saiba contra quem você compete em cada região e o tamanho da fatia de cada um.',
  },
  {
    label: 'Radar de Verba', icon: Wallet, pro: false,
    desc: 'Convênios e emendas federais de saúde — verba prestes a virar licitação.',
    passos: [
      'Filtre por UF.',
      'Ordene por verba não executada e por vencimento próximo.',
      'Abra um convênio/emenda para ver o valor disponível e o prazo.',
    ],
    valor: 'Verba com prazo curto para ser gasta = licitação iminente. Chegue antes do edital sair.',
  },
  {
    label: 'Preços de referência', icon: DollarSign, pro: false,
    desc: 'Preço praticado no Compras.gov por item, consultado sob demanda.',
    passos: [
      'Dentro de uma oportunidade, expanda um item.',
      'Veja o preço praticado no Compras.gov para aquele item/CATMAT.',
      'Use como piso/teto ao montar a sua proposta.',
    ],
    valor: 'Vá para a proposta com o preço de mercado na mão — menos achismo, mais margem.',
  },
  {
    label: 'Alertas', icon: Bell, pro: false,
    desc: 'Avisos automáticos quando surge uma oportunidade no seu perfil.',
    passos: [
      'Configure os critérios: categoria, UF e palavras-chave.',
      'Receba o aviso quando surgir algo no seu perfil.',
      'Abra o alerta para ir direto à oportunidade que o gerou.',
    ],
    valor: 'Pare de checar manualmente — a plataforma te chama quando aparece o que importa.',
  },
  {
    label: 'Meu Portfólio', icon: Boxes, pro: true,
    desc: 'Cadastre o que você vende; a plataforma prioriza as oportunidades que casam com o catálogo.',
    passos: [
      // Citava o botão "Carregar portfólio Siemens", que só existe na conta de
      // demonstração da Siemens — os demais clientes liam o nome de outra empresa
      // e procuravam um botão inexistente.
      'Cadastre seus produtos (nome, categoria, palavras-chave).',
      'Vincule códigos CATMAT quando quiser precificação automática.',
      'Volte às Licitações: as que casam com o seu catálogo passam a ser destacadas.',
    ],
    valor: 'Corta o ruído: você vê primeiro o que realmente vende, não o mercado inteiro.',
  },
  {
    label: 'CRM / Pipeline', icon: Kanban, pro: true,
    desc: 'Mova oportunidades por estágio, adicione notas e crie tarefas com prazo.',
    passos: [
      'Numa oportunidade, clique em "Adicionar ao pipeline".',
      'Arraste o card entre os estágios conforme a negociação avança.',
      'Adicione notas e tarefas com prazo em cada card.',
    ],
    valor: 'Gerencie o funil comercial sem sair de cima da inteligência de dados.',
  },
  {
    label: 'Agenda', icon: CalendarClock, pro: true,
    desc: 'Prazos de encerramento de propostas e follow-ups numa visão temporal.',
    passos: [
      'Veja os prazos das propostas que você acompanha, ordenados por urgência.',
      'Crie follow-ups com data.',
    ],
    valor: 'Nunca perca o prazo de envio de proposta de um edital que interessa.',
  },
  // DESATIVADO (a pedido) — Minhas Disputas. Reativar: descomentar este bloco.
  // {
  //   label: 'Minhas Disputas', icon: Flag, pro: true,
  //   desc: 'Acompanhe os editais que você está disputando, com status e prazos.',
  //   passos: [
  //     'Marque as licitações que você está disputando.',
  //     'Acompanhe status e prazos num só painel.',
  //   ],
  //   valor: 'Visão consolidada do que está em jogo agora — sem planilha paralela.',
  // },
  {
    label: 'Editais', icon: FileText, pro: true,
    desc: 'Leitura estruturada dos editais acompanhados.',
    passos: [
      'Abra um edital acompanhado.',
      'Leia o resumo estruturado: objeto, itens e exigências.',
    ],
    valor: 'Entenda o que o edital pede em minutos, sem ler dezenas de páginas.',
  },
  // DESATIVADO (a pedido) — Concorrentes (a tela Concorrentes/UF permanece).
  // {
  //   label: 'Concorrentes', icon: Users, pro: true,
  //   desc: 'Análise de concorrentes e participação (share) por estado.',
  //   passos: [
  //     'Selecione a categoria e a UF.',
  //     'Veja o share de cada concorrente.',
  //     'Compare a atuação deles por estado.',
  //   ],
  //   valor: 'Mapeie onde o concorrente é forte e onde há espaço aberto para atacar.',
  // },
  {
    label: 'Breakdown', icon: LayoutGrid, pro: true,
    desc: 'Detalhamento item a item dos resultados homologados.',
    passos: [
      'Abra o detalhamento item a item.',
      'Cruze item, quantidade e valor homologado.',
    ],
    valor: 'Análise fina de preço por item para afiar a proposta.',
  },
  {
    label: 'Mapa', icon: MapIcon, pro: true,
    desc: 'Oportunidades por município num mapa interativo.',
    passos: [
      'Abra o mapa e navegue pela região de interesse.',
      'Clique num município para ver as oportunidades locais.',
    ],
    valor: 'Planeje a rota comercial priorizando regiões por concentração de demanda.',
  },
  {
    label: 'Equipe', icon: Users, pro: true,
    desc: 'Convide usuários da sua empresa (assentos do plano); cada pessoa tem login próprio.',
    passos: [
      'Como titular, digite o e-mail do colega e clique em "Gerar convite".',
      'Copie o link exibido e envie para a pessoa (ou ela recebe por e-mail, se configurado).',
      'A pessoa abre o link, cria a própria senha e passa a ter login próprio.',
      'Remova um membro ou cancele um convite pelos ícones à direita de cada linha.',
    ],
    valor: 'Toda a equipe usa a mesma inteligência, cada um com seu acesso, dentro do limite do plano.',
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManualPage() {
  const { data: session } = useSession()
  const u = session?.user as { plano?: string | null; role?: string | null; status?: string | null } | undefined
  const isPro = temAcessoPro({ plano: u?.plano, role: u?.role, status: u?.status })
  const planoLabel = u?.role === 'master' ? 'Admin' : isPro ? 'Pro' : 'Essencial'
  const TOC = TOC_BASE
  const modulos = isPro ? MODULOS : MODULOS.filter((m) => !m.pro)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Manual do Usuário" subtitle={`Funções disponíveis no seu plano · ${planoLabel}`} />
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

              {/* ── Funcionalidades (por plano) ── */}
              <Section id="funcionalidades" title="Funcionalidades do seu plano" icon={LayoutGrid}>
                <div className="flex items-center gap-2 mb-4">
                  <span className={clsx('inline-flex items-center gap-1.5 text-[11px] font-mono-custom px-2.5 py-1 rounded-full border',
                    isPro ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-bg3 border-subtle2 text-muted')}>
                    <Crown size={11} /> Plano {planoLabel}
                  </span>
                  <span className="text-[12px] text-muted">
                    {isPro
                      ? 'Você tem acesso a todos os módulos abaixo.'
                      : 'Estes são os módulos incluídos no seu plano.'}
                  </span>
                </div>

                <div className="space-y-3">
                  {modulos.map(({ label, icon: Icon, desc, pro, passos, valor }) => (
                    <div key={label} className="bg-bg2 border border-subtle rounded-xl p-5">
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
                          <Icon size={14} className="text-accent" />
                        </div>
                        <span className="text-[14px] font-semibold text-strong">{label}</span>
                        {pro && <span className="text-[8px] font-mono-custom uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">Pro</span>}
                      </div>
                      <p className="text-[12px] text-muted leading-relaxed mb-3">{desc}</p>
                      <div className="text-[10px] font-mono-custom text-faint uppercase tracking-wider mb-2">Passo a passo</div>
                      <ol className="space-y-1.5 mb-3">
                        {passos.map((p, i) => (
                          <li key={i} className="flex gap-2.5 text-[12px] text-muted">
                            <span className="w-4 h-4 rounded-full bg-bg4 text-[9px] font-mono-custom flex items-center justify-center flex-shrink-0 mt-0.5 text-strong">{i + 1}</span>
                            <span className="leading-relaxed">{p}</span>
                          </li>
                        ))}
                      </ol>
                      <div className="flex items-start gap-2 bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
                        <CheckCircle size={12} className="text-accent mt-0.5 flex-shrink-0" />
                        <span className="text-[12px] text-muted leading-relaxed"><strong className="text-strong">Como extrair valor:</strong> {valor}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Upsell discreto para o plano Essencial */}
                {!isPro && u?.role !== 'master' && (
                  <div className="mt-3 p-4 bg-accent/5 border border-accent/20 rounded-xl flex items-start gap-3">
                    <Lock size={14} className="text-accent mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-[12px] font-semibold text-strong">Recursos Pro</div>
                      <p className="text-[12px] text-muted mt-0.5 leading-relaxed">
                        Portfólio inteligente, CRM/pipeline, mapa, análise de concorrentes, gestão de equipe e mais.{' '}
                        <Link href="/assinar?plano=pro" className="text-accent hover:underline">Conhecer o plano Pro →</Link>
                      </p>
                    </div>
                  </div>
                )}
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
              <Section id="sub-scores" title="Sub-scores e Capacidade de Pagamento" icon={TrendingUp}>
                <Card>
                  <p className="text-[13px] text-muted leading-relaxed mb-3">
                    O score final combina o <strong className="text-strong">score base</strong> (as quatro dimensões abaixo, que valem 85% no conjunto) com a <strong className="text-strong">Capacidade de Pagamento</strong> do ente público (15%). Os pesos efetivos de cada fator no score final ficam assim:
                  </p>
                  <div className="bg-bg3 rounded-lg p-3 mb-4 font-mono-custom text-[12px] text-muted">
                    <span className="text-accent">score final</span> = 0,85 × base + 0,15 × capacidade de pagamento
                  </div>
                  <p className="text-[13px] text-muted leading-relaxed mb-4">
                    As dimensões do score base são visíveis ao passar o mouse sobre o badge de score ou ao expandir o card. A capacidade de pagamento é aplicada a <strong className="text-strong">todas</strong> as oportunidades (convênio e histórico).
                  </p>
                  <div className="space-y-4">
                    {[
                      {
                        name: 'Convênio (25% do score final · 30% do base)',
                        color: 'text-accent',
                        items: [
                          'Percentual executado (≥80% = +40 pts)',
                          'Valor total do convênio (≥R$5M = +25 pts)',
                          'Dias até vencimento (≤60 dias = +25 pts)',
                          'Verba já liberada (≥80% = +10 pts)',
                        ],
                      },
                      {
                        name: 'Histórico (24% do score final · 28% do base)',
                        color: 'text-brand-blue',
                        items: [
                          'Idade do equipamento vs. ciclo médio da categoria',
                          'Anos desde a última compra registrada',
                          'Sazonalidade: abril–agosto têm mais licitações de saúde',
                        ],
                      },
                      {
                        name: 'Órgão (19% do score final · 22% do base)',
                        color: 'text-brand-purple',
                        items: [
                          'Emenda parlamentar aprovada (+50 pts — sinal fortíssimo)',
                          'Porte do hospital por número de leitos',
                          'Tipo de gestão: federal > estadual > municipal',
                        ],
                      },
                      {
                        name: 'Competição (17% do score final · 20% do base)',
                        color: 'text-amber',
                        items: [
                          'Concorrente líder perdeu último pregão (+40 pts)',
                          'Share do líder regional (<30% = mercado aberto)',
                          'Número de concorrentes históricos (≤2 = baixa disputa)',
                        ],
                      },
                      {
                        name: 'Capacidade de pagamento — CAPAG (15% do score final)',
                        color: 'text-emerald-400',
                        items: [
                          'Nota CAPAG do Tesouro Nacional (A/B/C/D) do município/estado — capacidade fiscal de honrar o contrato',
                          'Ente nota A/B pontua mais; C/D reduz o score (risco de calote/atraso)',
                          'Sem CAPAG (União/órgão federal) → fator neutro, não distorce o lead',
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
