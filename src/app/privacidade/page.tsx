// src/app/privacidade/page.tsx — Política de Privacidade (LGPD). Página PÚBLICA e estática
// (ver ROTAS_PUBLICAS no middleware). Cobre controlador, encarregado (DPO), dados tratados,
// finalidades + base legal (Art. 7 LGPD), compartilhamento, direitos do titular (Art. 18),
// retenção, segurança e cookies.
//
// ⚠️ PREENCHER com os dados reais antes de divulgar externamente: razão social + CNPJ do
//    controlador e nome/e-mail do Encarregado (DPO). Enquanto estiverem como placeholder, o
//    documento é um RASCUNHO — não substitui validação jurídica.

import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidade — GovHealth AI',
  description:
    'Como a GovHealth AI trata dados pessoais: dados coletados, finalidades e base legal (LGPD), compartilhamento, direitos do titular e segurança.',
}

// ── Dados do controlador / encarregado — PREENCHER com os valores reais ──────────
const CONTROLADOR_NOME = 'GovHealth AI'
const CONTROLADOR_RAZAO_SOCIAL = '[preencher: razão social]'
const CONTROLADOR_CNPJ = '[preencher: CNPJ]'
const DPO_NOME = '[preencher: nome do Encarregado]'
const DPO_EMAIL = 'privacidade@govhealth.ai'
const ATUALIZADO_EM = '2 de agosto de 2026'

interface Secao { titulo: string; conteudo: React.ReactNode }

const SECOES: Secao[] = [
  {
    titulo: '1. Controlador dos dados',
    conteudo: (
      <p>
        O tratamento dos dados pessoais descritos nesta política é realizado por{' '}
        <strong className="text-strong">{CONTROLADOR_RAZAO_SOCIAL}</strong> (CNPJ {CONTROLADOR_CNPJ}),
        operadora da plataforma {CONTROLADOR_NOME} (&ldquo;Plataforma&rdquo;), na qualidade de{' '}
        <strong className="text-strong">controladora</strong>, nos termos da Lei nº 13.709/2018 (LGPD).
      </p>
    ),
  },
  {
    titulo: '2. Encarregado (DPO)',
    conteudo: (
      <p>
        Nosso Encarregado pelo Tratamento de Dados Pessoais é {DPO_NOME}. Para exercer seus direitos
        ou esclarecer dúvidas sobre privacidade, contate{' '}
        <a href={`mailto:${DPO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{DPO_EMAIL}</a>.
      </p>
    ),
  },
  {
    titulo: '3. Dados que tratamos',
    conteudo: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><strong className="text-strong">Cadastro:</strong> nome, e-mail, senha (armazenada com hash bcrypt, nunca em texto), e, quando informados, empresa, telefone, CPF/CNPJ, instituição e endereço.</li>
        <li><strong className="text-strong">Uso e acesso:</strong> endereço IP, cidade/região aproximada, user-agent e datas/horas de login e navegação — para segurança e métricas de uso.</li>
        <li><strong className="text-strong">Conteúdo enviado:</strong> credenciais de portais (criptografadas com AES-256-GCM), documentos/certidões e relatos de suporte que você opte por cadastrar.</li>
        <li><strong className="text-strong">Pagamento:</strong> processado por gateway externo (Stripe). <strong className="text-strong">Não armazenamos dados de cartão</strong> em nossos servidores.</li>
      </ul>
    ),
  },
  {
    titulo: '4. Finalidades e base legal',
    conteudo: (
      <>
        <p className="mb-2">Tratamos dados pessoais para as seguintes finalidades, com as respectivas bases legais (Art. 7 da LGPD):</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-strong">Prestar o serviço</strong> (criar/manter conta, autenticar, entregar as análises) — <em>execução de contrato</em> (inc. V).</li>
          <li><strong className="text-strong">Segurança e prevenção a fraude/abuso</strong> (logs de acesso, rate limiting) — <em>legítimo interesse</em> (inc. IX).</li>
          <li><strong className="text-strong">Comunicações do serviço</strong> (alertas, avisos de vencimento, suporte) — <em>execução de contrato / legítimo interesse</em>.</li>
          <li><strong className="text-strong">Cumprimento de obrigações legais/fiscais</strong> (faturamento) — <em>obrigação legal</em> (inc. II).</li>
        </ul>
        <p className="mt-2 text-faint">Não utilizamos dados pessoais dos usuários para treinar modelos de IA nem os vendemos.</p>
      </>
    ),
  },
  {
    titulo: '5. Compartilhamento com terceiros (operadores)',
    conteudo: (
      <>
        <p className="mb-2">Compartilhamos dados apenas com prestadores que operam a Plataforma, no mínimo necessário:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className="text-strong">Vercel</strong> — hospedagem da aplicação.</li>
          <li><strong className="text-strong">Stripe</strong> — processamento de pagamentos.</li>
          <li><strong className="text-strong">Resend</strong> — envio de e-mails transacionais.</li>
          <li><strong className="text-strong">Upstash</strong> — controle de tráfego (rate limiting).</li>
          <li><strong className="text-strong">Z.ai</strong> — geração de texto do copiloto, quando você usa esse recurso.</li>
        </ul>
        <p className="mt-2 text-faint">Alguns operadores podem processar dados fora do Brasil; nesses casos, adotamos salvaguardas contratuais compatíveis com a LGPD (transferência internacional).</p>
      </>
    ),
  },
  {
    titulo: '6. Seus direitos (Art. 18 da LGPD)',
    conteudo: (
      <>
        <p className="mb-2">Você pode, a qualquer tempo, solicitar:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Confirmação da existência de tratamento e <strong className="text-strong">acesso</strong> aos seus dados;</li>
          <li><strong className="text-strong">Correção</strong> de dados incompletos ou desatualizados;</li>
          <li><strong className="text-strong">Eliminação/anonimização</strong> dos dados (respeitadas as retenções legais);</li>
          <li><strong className="text-strong">Portabilidade</strong> e informação sobre compartilhamentos;</li>
          <li><strong className="text-strong">Revogação do consentimento</strong>, quando esta for a base do tratamento.</li>
        </ul>
        <p className="mt-2">
          Para exercer, escreva para{' '}
          <a href={`mailto:${DPO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{DPO_EMAIL}</a>.
          Atendemos pedidos de exclusão por meio de <strong className="text-strong">anonimização</strong> do registro,
          que remove os dados que identificam a pessoa.
        </p>
      </>
    ),
  },
  {
    titulo: '7. Retenção',
    conteudo: (
      <p>
        Mantemos os dados de cadastro enquanto sua conta estiver ativa. Os <strong className="text-strong">logs de
        acesso</strong> (IP, geolocalização aproximada) são expurgados automaticamente após{' '}
        <strong className="text-strong">90 dias</strong>. Encerrada a conta, os dados que identificam o titular são
        anonimizados, ressalvadas hipóteses de guarda obrigatória por lei.
      </p>
    ),
  },
  {
    titulo: '8. Segurança',
    conteudo: (
      <p>
        Adotamos medidas técnicas e organizacionais compatíveis com o risco: senhas com hash{' '}
        <span className="font-mono-custom">bcrypt</span>, tráfego sob HTTPS/HSTS, <span className="font-mono-custom">Content-Security-Policy</span>,
        limitação de requisições (rate limiting), criptografia de credenciais de portais (AES-256-GCM) e
        controle de acesso por perfil. Nenhum sistema é perfeitamente seguro, mas trabalhamos para reduzir riscos.
      </p>
    ),
  },
  {
    titulo: '9. Cookies',
    conteudo: (
      <p>
        Utilizamos cookies estritamente necessários para autenticação e manutenção da sessão (NextAuth). Não
        empregamos cookies de publicidade de terceiros.
      </p>
    ),
  },
  {
    titulo: '10. Alterações desta política',
    conteudo: (
      <p>
        Podemos atualizar esta política para refletir mudanças legais ou do serviço. A data da última revisão
        é indicada no topo. Alterações relevantes serão comunicadas pelos canais da Plataforma.
      </p>
    ),
  },
]

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
        <p className="text-[11px] text-faint font-mono-custom mb-8">Última atualização: {ATUALIZADO_EM} · em conformidade com a LGPD (Lei nº 13.709/2018)</p>

        <div className="space-y-8">
          {SECOES.map((s) => (
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
