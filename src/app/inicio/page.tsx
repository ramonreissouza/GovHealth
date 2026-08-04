// src/app/inicio/page.tsx — landing PÚBLICA (modernizada — brief-landing-inicio.md).
// Tema claro hospitalar (tokens em globals.css). Estrutura enxuta em blocos, com
// números REAIS do banco, logo oficial, screenshots reais do produto e fundo
// autêntico (mapa da plataforma). Server Component + ISR (revalida a cada hora).

import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { clsx } from 'clsx'
import { ArrowRight, ShieldCheck, Check, Radar, Swords, Globe, MessageSquare, Tag, Wallet } from 'lucide-react'
import { PLANOS, precoLabel, orcamentoHref } from '@/lib/planos'
import { query } from '@/lib/db'
import { siteUrl } from '@/lib/site'

export const revalidate = 3600 // ISR: números atualizam a cada hora

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'GovHealth AI — Ache a licitação, ganhe a disputa, receba o pagamento',
  description:
    'Licitações de saúde de todo o Brasil: em qual portal a sessão acontece, alerta do chat do pregão e a capacidade de pagamento do município antes do seu lance. Dados oficiais, metodologia pública.',
  openGraph: {
    title: 'GovHealth AI — Ache a licitação, ganhe a disputa, receba o pagamento',
    description:
      'Onde a sessão acontece, alerta do chat do pregão e capacidade de pagamento do município — nas licitações de saúde de todo o Brasil.',
    type: 'website',
    images: ['/shots/dashboard.png'],
  },
  twitter: { card: 'summary_large_image', images: ['/shots/dashboard.png'] },
}

// Números reais (com fallback truthful medido no banco, caso a query falhe no build).
//
// `valor_total_estimado >= 10000` corta contratação simbólica. O teto de valor
// impossível NÃO é filtrado aqui de propósito: já é NULL no banco (ver
// scripts/limpar-ruido.mjs) e SUM ignora NULL. Antes daquele conserto esta página
// publicava R$ 2.680 bi — os 6 erros de digitação do PNCP somavam 10x a base real.
interface Stats {
  valor: number; total: number; munis: number; ufs: number; ult: string
  abertas: number; portais: number; fornecedores: number; capag: number; capagFraca: number
}
async function getStats(): Promise<Stats> {
  const fallback: Stats = {
    valor: 269_002_698_794, total: 63_867, munis: 4_420, ufs: 27, ult: '04/08/2026',
    abertas: 76_320, portais: 101, fornecedores: 14_668, capag: 4_774, capagFraca: 2_209,
  }
  try {
    const [r] = await query<Stats>(
      `SELECT sum(c.valor_total_estimado)::float8 AS valor, count(*)::int AS total,
              count(distinct c.municipio)::int AS munis, count(distinct c.uf)::int AS ufs,
              to_char(max(c.data_publicacao),'DD/MM/YYYY') AS ult,
              -- "Abertas" = sem resultado homologado. O situacao_id do PNCP fica velho,
              -- então a ausência de resultado é a fonte de verdade (ver memória do
              -- status aberto/encerrado).
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp))::int AS abertas,
              (SELECT count(distinct usuario_nome)::int FROM contratacoes WHERE usuario_nome IS NOT NULL) AS portais,
              (SELECT count(distinct ni_fornecedor)::int FROM resultados WHERE ni_fornecedor IS NOT NULL) AS fornecedores,
              (SELECT count(*)::int FROM capag) AS capag,
              -- Nota C ou D = capacidade de pagamento fraca. É o número que
              -- justifica olhar CAPAG antes de dar lance, então vem do banco.
              (SELECT count(*)::int FROM capag WHERE nota IN ('C','D')) AS "capagFraca"
         FROM contratacoes c
        WHERE c.valor_total_estimado >= 10000 AND c.objeto_compra IS NOT NULL`,
    )
    return r?.total ? r : fallback
  } catch {
    return fallback
  }
}

const num = (n: number) => n.toLocaleString('pt-BR')
const bilhoes = (v: number) => `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`

// Os 6 cards seguem o eixo DESCUBRA → DISPUTE → RECEBA (2 cards para cada etapa).
// A landing anterior tinha 3 cards e todos os três eram descoberta — que é
// justamente a parte que todo concorrente também vende. Disputa e recebimento são
// onde o fornecedor perde dinheiro de verdade, e é onde ninguém mais chega.
const RECURSOS = [
  { etapa: 'Descubra', icon: Radar, titulo: 'Radar pré-edital',
    texto: 'Emenda parlamentar, convênio e repasse que vão virar compra. Você fala com o órgão enquanto o concorrente espera o edital sair.' },
  { etapa: 'Descubra', icon: Globe, titulo: 'Onde a disputa acontece',
    texto: 'O PNCP é só o mural. A sessão roda no Licitanet, BNC, BLL, Compras.gov, Licitações-e ou no portal do município — e nós dizemos em qual.' },
  { etapa: 'Dispute', icon: MessageSquare, titulo: 'Monitor do chat do pregão',
    texto: 'Convocação, diligência e pedido de proposta ajustada aparecem no chat e têm prazo de horas. A gente vigia e te avisa por e-mail.' },
  { etapa: 'Dispute', icon: Tag, titulo: 'Preço de referência oficial',
    texto: 'O que o governo já pagou pelo mesmo item, do catálogo CATMAT: faixa, mediana, fornecedor e unidade de fornecimento.' },
  { etapa: 'Receba', icon: Wallet, titulo: 'A prefeitura vai te pagar?',
    texto: 'Nota de capacidade de pagamento (CAPAG, Tesouro Nacional) de A a D antes de você decidir se vale disputar.' },
  { etapa: 'Receba', icon: Swords, titulo: 'Quem é o incumbente',
    texto: 'Quem vence o quê, por item, valor e estado — e quando o contrato do concorrente vence, que é quando abre a sua janela.' },
]

const PASSOS = [
  { n: '01', t: 'Descubra', d: 'Emendas, convênios e licitações abertas de todo o Brasil, classificadas em 14 categorias de saúde e filtradas pelo que a sua empresa vende.' },
  { n: '02', t: 'Dispute', d: 'Portal certo, preço de referência do CATMAT, histórico do concorrente e o chat do pregão sob vigília — com alerta por e-mail.' },
  { n: '03', t: 'Receba', d: 'Capacidade de pagamento do município antes do lance, e o vencimento do contrato do incumbente para a próxima rodada.' },
]

export default async function InicioPage() {
  const s = await getStats()
  // Provas escolhidas para sustentar o eixo do hero, não para impressionar solto:
  // volume (bi), urgência (abertas agora), o dado que ninguém tem (portais) e
  // concorrência mapeada. Município/UF descem para o bloco do mapa.
  const PROVAS = [
    { v: bilhoes(s.valor), l: 'em licitações de saúde mapeadas' },
    { v: num(s.abertas), l: 'abertas agora, esperando proposta' },
    { v: num(s.portais), l: 'portais de disputa identificados' },
    { v: num(s.fornecedores), l: 'concorrentes com histórico rastreado' },
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
              {/* Três verbos = as três formas de perder dinheiro vendendo para a
                  saúde pública: não achar, achar e perder no detalhe, ganhar e não
                  receber. Vender só a primeira é o que todo concorrente já faz. */}
              <h1 className="reveal font-heading font-bold text-[40px] sm:text-[52px] leading-[1.03] tracking-tight" style={{ '--d': '0.05s' } as React.CSSProperties}>
                Ache a licitação.<br />Ganhe a disputa.<br /><span className="text-gradient-brand">Receba o pagamento.</span>
              </h1>
              <p className="reveal text-[17px] text-muted leading-relaxed max-w-[520px] mt-5" style={{ '--d': '0.1s' } as React.CSSProperties}>
                <strong className="text-strong">{num(s.abertas)} licitações de saúde abertas agora</strong>, espalhadas por{' '}
                {num(s.portais)} portais diferentes. A GovHealth mostra onde disputar, vigia o chat do
                pregão por você e diz se o município tem capacidade de pagar — antes do seu lance.
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

        {/* ── Bloco 3 — 6 cards, agrupados por etapa da jornada ──────────── */}
        <section className="max-w-[1080px] mx-auto px-6 py-20">
          <h2 className="reveal text-center font-heading font-bold text-[28px] mb-2">Da descoberta ao pagamento</h2>
          <p className="reveal text-center text-[14.5px] text-muted max-w-[560px] mx-auto mb-10">
            Achar a licitação é a parte fácil — e a única que os outros resolvem.
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            {RECURSOS.map(({ etapa, icon: Icon, titulo, texto }, i) => (
              <div key={titulo} className="reveal bg-bg2 border border-subtle rounded-2xl p-6 hover:border-accent/40 hover:shadow-lg hover:shadow-slate-200/50 transition-all" style={{ '--d': `${i * 0.08}s` } as React.CSSProperties}>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-brand flex items-center justify-center shadow-lg shadow-accent/20">
                    <Icon size={20} className="text-white" />
                  </div>
                  <span className="text-[10px] font-mono-custom uppercase tracking-wider text-faint border border-subtle rounded-full px-2 py-0.5">{etapa}</span>
                </div>
                <h3 className="font-heading font-semibold text-[16px] mb-1.5">{titulo}</h3>
                <p className="text-[13.5px] text-muted leading-relaxed">{texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bloco 3.5 — Os dois momentos em que se perde ────────────────── */}
        {/* Este é o bloco que diferencia o produto. Os dois painéis atacam perdas
            que o fornecedor já viveu e que nenhuma ferramenta de licitação cobre:
            o prazo do chat e o município que não paga. Números do banco, porque
            afirmação sem número em página de venda soa como promessa. */}
        <section className="border-y border-subtle bg-bg2">
          <div className="max-w-[1080px] mx-auto px-6 py-20">
            <p className="text-center text-[12px] font-mono-custom text-faint uppercase tracking-wider mb-3">Onde o dinheiro escapa</p>
            <h2 className="reveal text-center font-heading font-bold text-[28px] mb-10 max-w-[620px] mx-auto leading-tight">
              Duas licitações perdidas que não têm nada a ver com preço
            </h2>

            <div className="grid md:grid-cols-2 gap-5">
              <div className="reveal bg-bg3/60 border border-subtle rounded-2xl p-7">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={16} className="text-accent" />
                  <span className="text-[11px] font-mono-custom uppercase tracking-wider text-faint">Na hora da disputa</span>
                </div>
                <h3 className="font-heading font-bold text-[19px] mb-2.5 leading-snug">
                  &ldquo;O pregoeiro pediu documento no chat. Ninguém viu.&rdquo;
                </h3>
                <p className="text-[14px] text-muted leading-relaxed mb-4">
                  Convocação, diligência, pedido de proposta ajustada e recurso aparecem no chat da
                  sessão com prazo contado em horas. Quem não está com a tela aberta é desclassificado
                  por procedimento, tendo o melhor preço ou não.
                </p>
                <p className="text-[13.5px] text-strong leading-relaxed">
                  A GovHealth vigia o chat dos seus pregões e manda o alerta por e-mail com o texto da
                  mensagem — inclusive nos portais municipais, onde não existe app nem notificação.
                </p>
              </div>

              <div className="reveal bg-bg3/60 border border-subtle rounded-2xl p-7" style={{ '--d': '0.08s' } as React.CSSProperties}>
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={16} className="text-accent" />
                  <span className="text-[11px] font-mono-custom uppercase tracking-wider text-faint">Depois de ganhar</span>
                </div>
                <h3 className="font-heading font-bold text-[19px] mb-2.5 leading-snug">
                  &ldquo;Ganhamos, entregamos, e o empenho não saiu.&rdquo;
                </h3>
                <p className="text-[14px] text-muted leading-relaxed mb-4">
                  Ganhar de um município sem caixa é trocar estoque por processo. Dos{' '}
                  <strong className="text-strong">{num(s.capag)} municípios</strong> com nota de capacidade
                  de pagamento do Tesouro Nacional,{' '}
                  <strong className="text-strong">{num(s.capagFraca)} têm nota C ou D</strong> — capacidade fraca.
                </p>
                <p className="text-[13.5px] text-strong leading-relaxed">
                  A nota CAPAG aparece na própria licitação, antes do lance. Você escolhe disputar
                  sabendo com quem está lidando.
                </p>
              </div>
            </div>
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
          {/* Município e UF migraram das PROVAS para cá: aqui o número tem a imagem
              do mapa como evidência, em vez de ser mais um algarismo numa faixa. */}
          <p className="text-center text-[13px] text-muted mt-5">
            Cada ponto é uma licitação real de saúde — <strong className="text-strong">{num(s.munis)} municípios</strong> nos{' '}
            {s.ufs} estados, com {num(s.total)} contratações classificadas em 14 categorias.{' '}
            <span className="text-faint">Atualizado em {s.ult}.</span>
          </p>
        </section>

        {/* ── Planos ─────────────────────────────────────────────────────── */}
        <section id="planos" className="border-y border-subtle bg-bg3/60">
          <div className="max-w-[1080px] mx-auto px-6 py-20">
            <h2 className="text-center font-heading font-bold text-[28px] mb-1">Escolha o plano da sua operação</h2>
            <p className="text-center text-[13.5px] text-muted mb-10 max-w-[520px] mx-auto">Mensal, sem fidelidade. 3 dias grátis para testar. Nota fiscal em todos os planos.</p>
            <div className="grid sm:grid-cols-3 gap-5 max-w-[1000px] mx-auto">
              {PLANOS.map((p, i) => (
                <div key={p.id} className={clsx('reveal rounded-2xl p-7 border flex flex-col', p.destaque ? 'border-accent shadow-xl shadow-accent/10 bg-gradient-brand-soft' : 'border-subtle bg-bg2')} style={{ '--d': `${i * 0.08}s` } as React.CSSProperties}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-heading font-bold text-[19px]">{p.nome}</h3>
                    {p.destaque && <span className="text-[10px] font-mono-custom text-white bg-gradient-brand px-2 py-0.5 rounded-full font-bold">Mais completo</span>}
                    {p.contato && <span className="text-[10px] font-mono-custom text-brand-blue bg-brand-blue/10 border border-brand-blue/30 px-2 py-0.5 rounded-full font-bold">Equipe</span>}
                  </div>
                  <p className="text-[12.5px] text-muted mb-4">{p.resumo}</p>
                  <div className="flex items-baseline gap-1 mb-5">
                    <span className="font-heading font-bold text-[34px]">{precoLabel(p)}</span>
                    {!p.contato && <span className="text-[13px] text-faint">/{p.ciclo}</span>}
                  </div>
                  <ul className="space-y-2.5 mb-6 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-strong">
                        <Check size={15} className="text-accent flex-shrink-0 mt-0.5" /> {f}
                      </li>
                    ))}
                  </ul>
                  {p.contato ? (
                    <a href={orcamentoHref(p.nome)}
                      className="inline-flex items-center justify-center gap-2 text-[14px] font-semibold px-5 py-3 rounded-xl transition-all bg-bg2 border border-brand-blue/50 text-brand-blue hover:bg-brand-blue/5">
                      Entrar em contato para orçamento <ArrowRight size={15} />
                    </a>
                  ) : (
                    <>
                      <Link href={`/login?criar=1&plano=${p.id}`}
                        className={clsx('inline-flex items-center justify-center gap-2 text-[14px] font-semibold px-5 py-3 rounded-xl transition-all',
                          p.destaque ? 'bg-gradient-brand text-white hover:brightness-105 shadow-lg shadow-accent/20' : 'bg-bg2 border border-subtle2 text-strong hover:border-accent/50')}>
                        Testar {p.nome} · 3 dias grátis <ArrowRight size={15} />
                      </Link>
                      <Link href={`/assinar?plano=${p.id}`} className="text-center text-[11px] text-faint hover:text-accent mt-2.5">ou assinar direto</Link>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-faint mt-5">O <strong className="text-muted">Radar de Chat</strong> e o uso por equipe (vários usuários) são exclusivos do plano <strong className="text-muted">Empresa</strong>. <a href={orcamentoHref('Empresa')} className="text-accent hover:underline">Fale com a gente</a>.</p>
          </div>
        </section>

        {/* ── Bloco 6 — CTA final ────────────────────────────────────────── */}
        <section className="max-w-[1080px] mx-auto px-6 py-20">
          <div className="reveal relative overflow-hidden rounded-3xl bg-gradient-brand px-8 py-14 text-center">
            <div aria-hidden className="absolute -top-24 -right-24 w-[360px] h-[360px] rounded-full bg-white/10 blur-3xl" />
            {/* Fecha com o número que dá urgência real: as abertas de agora têm prazo
                correndo. "Comece antes do próximo edital" era abstrato — havia
                sempre um próximo, então não havia motivo para ser hoje. */}
            <h2 className="font-heading font-bold text-[26px] sm:text-[30px] text-white relative">
              {num(s.abertas)} licitações estão abertas neste momento
            </h2>
            <p className="text-[14.5px] text-white/85 mt-2 mb-7 relative max-w-[480px] mx-auto">
              Veja quais são da sua categoria, em qual portal disputar e se o município paga.
              Teste grátis por 3 dias, sem cartão e sem fidelidade.
            </p>
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
