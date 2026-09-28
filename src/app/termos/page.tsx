// src/app/termos/page.tsx — Termos de Uso. Página PÚBLICA e estática (ver ROTAS_PUBLICAS
// no middleware): um contrato que só abre depois do login não vale como contrato.
//
// Espelha a estrutura da Política de Privacidade de propósito — mesmo cabeçalho, mesma
// lista de seções, mesmos dados de empresa vindos de src/lib/empresa-legal.ts.
//
// A seção 6 (natureza dos dados) é a que mais importa para ESTE produto e não é boilerplate:
// a Plataforma lê fontes públicas oficiais que atrasam, corrigem e às vezes omitem, e já
// medimos isso — jan–jun/2025 chegou a ter 30-59% das linhas faltando até ser recoletado.
// Prometer completude seria vender o que nenhuma fonte pública entrega.
//
// ⚠️ Escrito por engenharia, não por advogado. Revisão jurídica ANTES do primeiro contrato
//    pago — especialmente as cláusulas de limitação de responsabilidade e foro, que são as
//    que um juiz lê primeiro quando algo dá errado.

import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import {
  CONTROLADOR_NOME, CONTROLADOR_RAZAO_SOCIAL, CONTROLADOR_CNPJ, CONTROLADOR_SEDE,
  CONTATO_EMAIL, FORO, TERMOS_VERSAO,
} from '@/lib/empresa-legal'

export const metadata: Metadata = {
  title: 'Termos de Uso — GovHealth AI',
  description:
    'Condições de uso da plataforma GovHealth AI: objeto, conta e acesso, planos e pagamento, natureza dos dados de fontes públicas, uso aceitável e responsabilidades.',
}

const ATUALIZADO_EM = '27 de setembro de 2026'

interface Secao { titulo: string; conteudo: React.ReactNode }

const SECOES: Secao[] = [
  {
    titulo: '1. Quem somos e o que estes Termos regulam',
    conteudo: (
      <p>
        A plataforma {CONTROLADOR_NOME} (&ldquo;Plataforma&rdquo;) é operada por{' '}
        <strong className="text-strong">{CONTROLADOR_RAZAO_SOCIAL}</strong> (CNPJ {CONTROLADOR_CNPJ},{' '}
        {CONTROLADOR_SEDE}), doravante &ldquo;Contratada&rdquo;. Estes Termos de Uso regulam o acesso e o uso
        da Plataforma por você ou pela pessoa jurídica que você representa (&ldquo;Cliente&rdquo;). Ao criar uma
        conta, iniciar um teste gratuito ou contratar um plano, o Cliente declara que leu, entendeu e aceita
        integralmente estes Termos e a{' '}
        <Link href="/privacidade" className="text-accent hover:underline">Política de Privacidade</Link>.
      </p>
    ),
  },
  {
    titulo: '2. O que a Plataforma faz',
    conteudo: (
      <>
        <p className="mb-3">
          A Plataforma é um software como serviço (SaaS) de inteligência comercial para vendas ao setor
          público de saúde. Ela coleta, organiza, classifica e apresenta informações de fontes públicas
          oficiais, e oferece ferramentas de busca, alerta, acompanhamento e exportação sobre esses dados.
        </p>
        <p>
          A Contratada concede ao Cliente uma licença de uso pessoal, temporária, não exclusiva e
          intransferível da Plataforma, limitada ao plano contratado e vigente enquanto durar a assinatura.
          Nenhuma cláusula destes Termos transfere ao Cliente a titularidade do software, da marca, do
          código-fonte, da modelagem de dados ou dos métodos de classificação e pontuação.
        </p>
      </>
    ),
  },
  {
    titulo: '3. Conta, acesso e responsabilidade pelas credenciais',
    conteudo: (
      <>
        <p className="mb-3">
          O cadastro exige dados verdadeiros e atualizados. As credenciais são pessoais e intransferíveis:
          cada assento contratado corresponde a <strong className="text-strong">uma pessoa</strong>. Compartilhar
          login entre usuários, revender ou ceder acesso a terceiros é descumprimento destes Termos e autoriza
          a suspensão imediata da conta.
        </p>
        <p>
          O Cliente é responsável por tudo que ocorrer sob suas credenciais e deve comunicar à Contratada, pelo
          e-mail{' '}
          <a href={`mailto:${CONTATO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{CONTATO_EMAIL}</a>,
          qualquer uso não autorizado de que tomar conhecimento.
        </p>
      </>
    ),
  },
  {
    titulo: '4. Teste gratuito',
    conteudo: (
      <p>
        A Plataforma pode oferecer período de teste gratuito, com prazo informado no momento do cadastro e sem
        exigência de cartão. Findo o prazo sem contratação de um plano, o acesso é encerrado automaticamente. O
        teste é concedido uma vez por pessoa ou empresa e pode ser alterado ou descontinuado a qualquer tempo
        para novos cadastros, sem afetar testes já em curso.
      </p>
    ),
  },
  {
    titulo: '5. Planos, preços, pagamento e cancelamento',
    conteudo: (
      <>
        <p className="mb-3">
          Os planos, seus preços e o que cada um inclui são os exibidos na Plataforma no momento da
          contratação. A assinatura é mensal, <strong className="text-strong">sem fidelidade</strong>, e se
          renova automaticamente por períodos iguais até que o Cliente a cancele. A Contratada emite nota
          fiscal em todos os planos.
        </p>
        <p className="mb-3">
          O pagamento pode ser feito por cartão de crédito com cobrança recorrente, Pix ou boleto, conforme as
          opções disponíveis. Em pagamentos manuais (Pix e boleto), o acesso é liberado após a confirmação do
          pagamento. O não pagamento na data de vencimento autoriza a suspensão do acesso até a regularização.
        </p>
        <p className="mb-3">
          O cancelamento pode ser solicitado a qualquer momento e passa a valer ao fim do ciclo já pago, sem
          multa. Não há reembolso proporcional de ciclo em curso, ressalvado o direito de arrependimento em até
          7 dias da contratação quando aplicável o art. 49 do Código de Defesa do Consumidor.
        </p>
        <p>
          Reajustes de preço serão comunicados com no mínimo 30 dias de antecedência e valem a partir do ciclo
          seguinte. O Cliente que não concordar pode cancelar antes da vigência do novo valor, sem ônus.
        </p>
      </>
    ),
  },
  {
    titulo: '6. Natureza dos dados: o que garantimos e o que não garantimos',
    conteudo: (
      <>
        <p className="mb-3">
          As informações exibidas na Plataforma são obtidas de <strong className="text-strong">fontes públicas
          oficiais</strong> — entre elas o PNCP, o Portal da Transparência, o TransfereGov, o Compras.gov.br e o
          CNES — e reorganizadas para uso comercial. A Contratada não produz esses dados, não os audita e não
          responde pelo que a fonte publica.
        </p>
        <p className="mb-3">
          Fontes públicas atrasam, corrigem, republicam e por vezes omitem registros. Por isso a Contratada{' '}
          <strong className="text-strong">não garante completude, exatidão, atualidade nem disponibilidade
          ininterrupta</strong> das informações. Scores, classificações, estimativas de preço e sugestões são
          apoio à decisão, calculados por critérios próprios descritos em{' '}
          <Link href="/metodologia" className="text-accent hover:underline">Fontes e metodologia</Link> — não são
          declaração de fato nem recomendação vinculante.
        </p>
        <p>
          A Plataforma <strong className="text-strong">não presta consultoria jurídica, contábil ou de
          licitações</strong> e não garante resultado em nenhum certame. Toda decisão comercial, toda proposta e
          toda peça apresentada a órgão público são de responsabilidade exclusiva do Cliente, que deve conferir
          a informação na fonte oficial antes de agir. A Plataforma indica o link da fonte justamente para isso.
        </p>
      </>
    ),
  },
  {
    titulo: '7. Uso aceitável',
    conteudo: (
      <>
        <p className="mb-3">O Cliente se compromete a não:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>extrair dados de forma automatizada (scraping, robôs, requisições em massa) fora das funções de exportação oferecidas;</li>
          <li>revender, sublicenciar, redistribuir ou disponibilizar a terceiros o conteúdo da Plataforma, no todo ou em parte;</li>
          <li>fazer engenharia reversa, descompilar ou tentar obter o código-fonte e os critérios internos de classificação;</li>
          <li>contornar limites técnicos, de assentos ou de plano;</li>
          <li>usar a Plataforma para finalidade ilícita, ou de modo que comprometa sua segurança, integridade ou desempenho para os demais clientes.</li>
        </ul>
      </>
    ),
  },
  {
    titulo: '8. Disponibilidade e manutenção',
    conteudo: (
      <p>
        A Contratada empenha esforços razoáveis para manter a Plataforma disponível, mas não oferece garantia
        formal de nível de serviço (SLA) nos planos de autosserviço. Poderá haver interrupções para manutenção,
        atualização, correção ou por falha de terceiros dos quais a Plataforma depende, incluindo as próprias
        fontes públicas e os provedores de infraestrutura. Interrupções programadas de impacto relevante serão
        comunicadas com antecedência sempre que possível.
      </p>
    ),
  },
  {
    titulo: '9. Limitação de responsabilidade',
    conteudo: (
      <p>
        Na máxima extensão permitida pela legislação brasileira, a responsabilidade da Contratada perante o
        Cliente, por qualquer causa relacionada à Plataforma, fica limitada ao valor efetivamente pago pelo
        Cliente nos 12 meses anteriores ao fato gerador. A Contratada não responde por lucros cessantes, perda
        de oportunidade comercial, perda de certame, danos indiretos ou decisões tomadas pelo Cliente com base
        nas informações da Plataforma. Esta limitação não se aplica a dolo, fraude ou às hipóteses em que a lei
        vedar a limitação.
      </p>
    ),
  },
  {
    titulo: '10. Proteção de dados pessoais',
    conteudo: (
      <p>
        O tratamento de dados pessoais observa a Lei nº 13.709/2018 (LGPD) e está descrito na{' '}
        <Link href="/privacidade" className="text-accent hover:underline">Política de Privacidade</Link>, que
        integra estes Termos. Quanto aos dados de seus próprios usuários e contatos inseridos na Plataforma, o
        Cliente atua como controlador e declara ter base legal para tratá-los.
      </p>
    ),
  },
  {
    titulo: '11. Suspensão e encerramento',
    conteudo: (
      <p>
        A Contratada pode suspender ou encerrar o acesso, mediante aviso, em caso de descumprimento destes
        Termos, inadimplência ou uso que ameace a segurança da Plataforma. Encerrada a conta, o Cliente pode
        solicitar a exportação de seus dados em até 30 dias, findos os quais eles poderão ser eliminados,
        observados os prazos legais de retenção previstos na Política de Privacidade.
      </p>
    ),
  },
  {
    titulo: '12. Alterações destes Termos',
    conteudo: (
      <p>
        Estes Termos podem ser atualizados para refletir mudanças legais ou do serviço. A data da última
        revisão é indicada no topo desta página, e alterações relevantes serão comunicadas pelos canais da
        Plataforma com antecedência razoável. O uso após a vigência da nova versão significa concordância com
        ela; quem não concordar pode cancelar sem ônus.
      </p>
    ),
  },
  {
    titulo: '13. Legislação aplicável e foro',
    conteudo: (
      <p>
        Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de{' '}
        {FORO} para dirimir controvérsias dele decorrentes, com renúncia a qualquer outro, por mais privilegiado
        que seja — ressalvado, ao Cliente pessoa física consumidora, o direito de demandar no foro de seu
        domicílio.
      </p>
    ),
  },
]

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
        <p className="text-[11px] text-faint font-mono-custom mb-8">Última atualização: {ATUALIZADO_EM} · versão {TERMOS_VERSAO} · {CONTROLADOR_RAZAO_SOCIAL} · CNPJ {CONTROLADOR_CNPJ}</p>

        <div className="space-y-8">
          {SECOES.map((s) => (
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
