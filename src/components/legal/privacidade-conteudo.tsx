// src/components/legal/privacidade-conteudo.tsx — o TEXTO da Política de Privacidade (LGPD).
//
// Mesma razão de termos-conteudo.tsx: lido pela página pública /privacidade e pela janela
// do cadastro antes do "Li e estou de acordo". Cobre controlador, encarregado (DPO), dados
// tratados, finalidades + base legal (art. 7º), dados de fontes públicas, compartilhamento,
// direitos do titular (art. 18), retenção, segurança, incidentes (art. 48) e cookies.
//
// Os dados do controlador vêm de src/lib/empresa-legal.ts — mesma fonte dos Termos de Uso,
// porque dois documentos legais que se contradizem sobre quem é a empresa são pior que um.
//
// ⚠️ Este texto não substitui validação jurídica.
//
// Regra: MUDOU O TEXTO aqui, MUDA PRIVACIDADE_VERSAO em src/lib/empresa-legal.ts no mesmo commit.

import Link from 'next/link'
import { CONTROLADOR_NOME, CONTROLADOR_RAZAO_SOCIAL, CONTROLADOR_CNPJ, CONTROLADOR_SEDE, DPO_NOME, DPO_EMAIL } from '@/lib/empresa-legal'
import type { SecaoLegal } from './termos-conteudo'

export const PRIVACIDADE_ATUALIZADO_EM = '1º de novembro de 2026'

const forte = 'text-strong'

export const SECOES_PRIVACIDADE: SecaoLegal[] = [
  {
    titulo: '1. Controlador dos dados',
    conteudo: (
      <p>
        O tratamento dos dados pessoais descritos nesta política é realizado por{' '}
        <strong className={forte}>{CONTROLADOR_RAZAO_SOCIAL}</strong>, inscrita no CNPJ sob o nº {CONTROLADOR_CNPJ},
        com sede na {CONTROLADOR_SEDE}, operadora da plataforma {CONTROLADOR_NOME} (&ldquo;Plataforma&rdquo;), na qualidade de{' '}
        <strong className={forte}>controladora</strong>, nos termos da Lei nº 13.709/2018 (LGPD).
      </p>
    ),
  },
  {
    titulo: '2. Encarregado (DPO)',
    conteudo: (
      <p>
        {DPO_NOME
          ? <>Nosso Encarregado pelo Tratamento de Dados Pessoais é <strong className={forte}>{DPO_NOME}</strong>. Para exercer seus direitos</>
          : <>O canal do Encarregado pelo Tratamento de Dados Pessoais é o e-mail abaixo. Para exercer seus direitos</>}
        ou esclarecer dúvidas sobre privacidade, contate{' '}
        <a href={`mailto:${DPO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{DPO_EMAIL}</a>.
      </p>
    ),
  },
  {
    titulo: '3. Dados que tratamos',
    conteudo: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><strong className={forte}>Cadastro:</strong> nome, e-mail, senha (armazenada com hash bcrypt, nunca em texto), e, quando informados, empresa, telefone, CPF/CNPJ, instituição e endereço.</li>
        <li><strong className={forte}>Registro do aceite:</strong> a versão dos Termos de Uso e desta Política que você aceitou, a data e a hora do aceite e o endereço IP de origem.</li>
        <li><strong className={forte}>Uso e acesso:</strong> endereço IP, cidade/região aproximada, user-agent e datas/horas de login e navegação — para segurança e métricas de uso.</li>
        <li><strong className={forte}>Conteúdo enviado:</strong> credenciais de portais (criptografadas com AES-256-GCM), documentos/certidões e relatos de suporte que você opte por cadastrar.</li>
        <li><strong className={forte}>Pagamento:</strong> processado por gateway externo (Stripe). <strong className={forte}>Não armazenamos dados de cartão</strong> em nossos servidores.</li>
      </ul>
    ),
  },
  {
    titulo: '4. Finalidades e base legal',
    conteudo: (
      <>
        <p className="mb-2">Tratamos dados pessoais para as seguintes finalidades, com as respectivas bases legais (art. 7º da LGPD):</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className={forte}>Prestar o serviço</strong> (criar/manter conta, autenticar, entregar as análises) — <em>execução de contrato</em> (inc. V).</li>
          <li><strong className={forte}>Segurança e prevenção a fraude/abuso</strong> (logs de acesso, rate limiting) — <em>legítimo interesse</em> (inc. IX).</li>
          <li><strong className={forte}>Comunicações do serviço</strong> (alertas, avisos de vencimento, suporte) — <em>execução de contrato / legítimo interesse</em>.</li>
          <li><strong className={forte}>Comprovar o aceite</strong> dos Termos de Uso e desta Política — <em>exercício regular de direitos</em> (inc. VI).</li>
          <li><strong className={forte}>Cumprimento de obrigações legais/fiscais</strong> (faturamento) — <em>obrigação legal</em> (inc. II).</li>
        </ul>
        <p className="mt-2 text-faint">Não utilizamos dados pessoais dos usuários para treinar modelos de IA nem os vendemos.</p>
      </>
    ),
  },
  {
    titulo: '5. Dados de fontes públicas e dados que o Cliente insere',
    conteudo: (
      <>
        <p className="mb-3">
          A Plataforma reorganiza informações publicadas por fontes oficiais (PNCP, Portal da Transparência,
          TransfereGov, Compras.gov.br, CNES e outras). Esses registros podem conter dados pessoais — por
          exemplo, o nome de um servidor que assina um edital ou do representante de uma empresa numa ata. Eles
          são tratados apenas para a finalidade de transparência e acompanhamento de compras públicas que
          justificou sua publicação, observando a boa-fé e o interesse público (art. 7º, § 3º, da LGPD).
        </p>
        <p>
          Quanto aos dados pessoais que o Cliente cadastra por conta própria (contatos no CRM, nomes em
          documentos e anotações), o Cliente é o controlador e nós atuamos como operadora, nos termos da
          seção 10 dos{' '}
          <Link href="/termos" className="text-accent hover:underline">Termos de Uso</Link>.
        </p>
      </>
    ),
  },
  {
    titulo: '6. Compartilhamento com terceiros (operadores)',
    conteudo: (
      <>
        <p className="mb-2">Compartilhamos dados apenas com prestadores que operam a Plataforma, no mínimo necessário:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li><strong className={forte}>Vercel</strong> — hospedagem da aplicação.</li>
          <li><strong className={forte}>Provedores de servidores em nuvem</strong> — hospedagem do banco de dados e dos serviços de coleta.</li>
          <li><strong className={forte}>Stripe</strong> — processamento de pagamentos.</li>
          <li><strong className={forte}>Resend</strong> — envio de e-mails transacionais.</li>
          <li><strong className={forte}>Upstash</strong> — controle de tráfego (rate limiting).</li>
          <li><strong className={forte}>Atlassian (Jira)</strong> — acompanhamento dos relatos de suporte que você enviar.</li>
          <li><strong className={forte}>Z.ai</strong> — geração de texto do copiloto, quando você usa esse recurso.</li>
          <li><strong className={forte}>Google</strong> — autenticação, somente se você optar por entrar com sua conta Google.</li>
        </ul>
        <p className="mt-2 text-faint">
          Alguns operadores podem processar dados fora do Brasil; nesses casos, adotamos salvaguardas contratuais
          compatíveis com a LGPD (transferência internacional, art. 33). Também podemos compartilhar dados quando
          exigido por lei, ordem judicial ou requisição de autoridade competente.
        </p>
      </>
    ),
  },
  {
    titulo: '7. Seus direitos (art. 18 da LGPD)',
    conteudo: (
      <>
        <p className="mb-2">Você pode, a qualquer tempo, solicitar:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Confirmação da existência de tratamento e <strong className={forte}>acesso</strong> aos seus dados;</li>
          <li><strong className={forte}>Correção</strong> de dados incompletos ou desatualizados;</li>
          <li><strong className={forte}>Eliminação/anonimização</strong> dos dados (respeitadas as retenções legais);</li>
          <li><strong className={forte}>Portabilidade</strong> e informação sobre compartilhamentos;</li>
          <li><strong className={forte}>Revogação do consentimento</strong>, quando esta for a base do tratamento.</li>
        </ul>
        <p className="mt-2">
          Para exercer, escreva para{' '}
          <a href={`mailto:${DPO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{DPO_EMAIL}</a>.
          Respondemos em até <strong className={forte}>15 dias</strong> (art. 19, II, da LGPD). Atendemos pedidos
          de exclusão por meio de <strong className={forte}>anonimização</strong> do registro, que remove os dados
          que identificam a pessoa. Você também pode peticionar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </>
    ),
  },
  {
    titulo: '8. Retenção',
    conteudo: (
      <p>
        Mantemos os dados de cadastro enquanto sua conta estiver ativa. Os <strong className={forte}>logs de
        acesso</strong> (IP, geolocalização aproximada) são expurgados automaticamente após{' '}
        <strong className={forte}>90 dias</strong>. O registro do aceite (versão dos documentos, data e IP) é
        mantido enquanto durar a relação e pelo prazo em que possa ser necessário para defesa em processo
        (exercício regular de direitos). Encerrada a conta, os dados que identificam o titular são anonimizados
        — incluindo o IP do aceite —, ressalvadas hipóteses de guarda obrigatória por lei; a versão aceita e a
        data, que sozinhas não identificam ninguém, permanecem.
      </p>
    ),
  },
  {
    titulo: '9. Segurança',
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
    titulo: '10. Incidentes de segurança',
    conteudo: (
      <p>
        Se ocorrer incidente de segurança que possa acarretar risco ou dano relevante aos titulares,
        comunicaremos a ANPD e os titulares afetados nos prazos e na forma do art. 48 da LGPD e da
        regulamentação da ANPD, informando a natureza dos dados afetados, os riscos e as medidas adotadas.
        Quando o incidente atingir dados que o Cliente controla, avisaremos também o Cliente, conforme os
        Termos de Uso.
      </p>
    ),
  },
  {
    titulo: '11. Cookies',
    conteudo: (
      <p>
        Utilizamos cookies estritamente necessários para autenticação e manutenção da sessão (NextAuth). Não
        empregamos cookies de publicidade de terceiros.
      </p>
    ),
  },
  {
    titulo: '12. Crianças e adolescentes',
    conteudo: (
      <p>
        A Plataforma é um serviço profissional, destinado a empresas e a maiores de 18 anos. Não coletamos
        intencionalmente dados de crianças ou adolescentes.
      </p>
    ),
  },
  {
    titulo: '13. Alterações desta política',
    conteudo: (
      <p>
        Podemos atualizar esta política para refletir mudanças legais ou do serviço. A data e a versão da
        última revisão são indicadas no topo. Alterações relevantes serão comunicadas pelos canais da
        Plataforma.
      </p>
    ),
  },
]
