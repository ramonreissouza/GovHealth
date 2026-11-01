// src/components/legal/termos-conteudo.tsx — o TEXTO dos Termos de Uso, num lugar só.
//
// Mora fora de src/app/termos porque é lido em dois lugares: na página pública /termos e
// na janela que o cadastro abre antes do "Li e estou de acordo" (components/legal/
// AceiteTermos). Duas cópias do mesmo contrato divergem na primeira alteração — e a
// pessoa aceitaria um texto diferente do publicado.
//
// Sem 'use client': só JSX e next/link, serve tanto ao componente de servidor quanto ao
// de cliente.
//
// A seção 6 (natureza dos dados) é a que mais importa para ESTE produto e não é boilerplate:
// a Plataforma lê fontes públicas oficiais que atrasam, corrigem e às vezes omitem, e já
// medimos isso — jan–jun/2025 chegou a ter 30-59% das linhas faltando até ser recoletado.
// Prometer completude seria vender o que nenhuma fonte pública entrega.
//
// A seção 9 (confidencialidade) também é específica: concorrentes diretos são clientes da
// mesma Plataforma, então o que um acompanha (pregões, órgãos, produtos, concorrentes) é
// o segredo comercial que ele mais teme ver vazar para o outro.
//
// ⚠️ Escrito por engenharia, não por advogado. Revisão jurídica ANTES do primeiro contrato
//    pago — especialmente limitação de responsabilidade, indenização e foro, que são as
//    que um juiz lê primeiro quando algo dá errado.
//
// Regra: MUDOU O TEXTO aqui, MUDA TERMOS_VERSAO em src/lib/empresa-legal.ts no mesmo commit.

import Link from 'next/link'
import {
  CONTROLADOR_NOME, CONTROLADOR_RAZAO_SOCIAL, CONTROLADOR_CNPJ, CONTROLADOR_SEDE,
  CONTATO_EMAIL, DPO_EMAIL, FORO,
} from '@/lib/empresa-legal'

export const TERMOS_ATUALIZADO_EM = '1º de novembro de 2026'

export interface SecaoLegal { titulo: string; conteudo: React.ReactNode }

const forte = 'text-strong'

export const SECOES_TERMOS: SecaoLegal[] = [
  {
    titulo: '1. Quem somos e o que estes Termos regulam',
    conteudo: (
      <p>
        A plataforma {CONTROLADOR_NOME} (&ldquo;Plataforma&rdquo;) é operada por{' '}
        <strong className={forte}>{CONTROLADOR_RAZAO_SOCIAL}</strong>, inscrita no CNPJ sob o nº{' '}
        {CONTROLADOR_CNPJ}, com sede na {CONTROLADOR_SEDE}, doravante &ldquo;Contratada&rdquo;. Estes Termos de Uso regulam o acesso e o uso
        da Plataforma por você ou pela pessoa jurídica que você representa (&ldquo;Cliente&rdquo;); Contratada e
        Cliente são, em conjunto, as &ldquo;Partes&rdquo;. Ao criar uma conta, aceitar um convite de equipe,
        iniciar um teste gratuito ou contratar um plano, o Cliente declara que leu, entendeu e aceita
        integralmente estes Termos e a{' '}
        <Link href="/privacidade" className="text-accent hover:underline">Política de Privacidade</Link>, que
        os integra.
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
          cada assento contratado corresponde a <strong className={forte}>uma pessoa</strong>. Compartilhar
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
        para novos cadastros, sem afetar testes já em curso. As cláusulas de confidencialidade e de proteção de
        dados destes Termos valem integralmente também durante o teste.
      </p>
    ),
  },
  {
    titulo: '5. Planos, preços, pagamento e cancelamento',
    conteudo: (
      <>
        <p className="mb-3">
          Os planos, seus preços e o que cada um inclui são os exibidos na Plataforma no momento da
          contratação. A assinatura é mensal, <strong className={forte}>sem fidelidade</strong>, e se
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
          As informações exibidas na Plataforma são obtidas de <strong className={forte}>fontes públicas
          oficiais</strong> — entre elas o PNCP, o Portal da Transparência, o TransfereGov, o Compras.gov.br e o
          CNES — e reorganizadas para uso comercial. A Contratada não produz esses dados, não os audita e não
          responde pelo que a fonte publica.
        </p>
        <p className="mb-3">
          Fontes públicas atrasam, corrigem, republicam e por vezes omitem registros. Por isso a Contratada{' '}
          <strong className={forte}>não garante completude, exatidão, atualidade nem disponibilidade
          ininterrupta</strong> das informações. Scores, classificações, estimativas de preço e sugestões são
          apoio à decisão, calculados por critérios próprios descritos em{' '}
          <Link href="/metodologia" className="text-accent hover:underline">Fontes e metodologia</Link> — não são
          declaração de fato nem recomendação vinculante.
        </p>
        <p>
          A Plataforma <strong className={forte}>não presta consultoria jurídica, contábil ou de
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
          <li>
            usar a Plataforma para combinar preços, frustrar o caráter competitivo de licitação ou praticar
            qualquer ato lesivo à administração pública, nos termos da Lei nº 14.133/2021 e da Lei
            nº 12.846/2013 (Lei Anticorrupção);
          </li>
          <li>
            inserir dados pessoais de terceiros sem base legal, dados pessoais sensíveis desnecessários (em
            especial <strong className={forte}>dados de saúde de pacientes</strong>, que a Plataforma não
            precisa nem foi feita para guardar), ou conteúdo ilícito ou que viole direitos de terceiros;
          </li>
          <li>usar a Plataforma para finalidade ilícita, ou de modo que comprometa sua segurança, integridade ou desempenho para os demais clientes.</li>
        </ul>
      </>
    ),
  },
  {
    titulo: '8. Dados do Cliente e credenciais de portais',
    conteudo: (
      <>
        <p className="mb-3">
          Pertencem ao Cliente os dados e conteúdos que ele insere na Plataforma — setup da empresa, portfólio
          de produtos, CRM, anotações, documentos, palavras-chave e pregões monitorados (&ldquo;Dados do
          Cliente&rdquo;). O Cliente concede à Contratada apenas a autorização necessária para armazenar,
          processar e exibir esses dados com a finalidade de prestar o serviço contratado.
        </p>
        <p>
          Ao cadastrar credenciais de acesso a portais de compras públicas, o Cliente declara ter autorização
          para usá-las e autoriza a Contratada a utilizá-las{' '}
          <strong className={forte}>exclusivamente para leitura automatizada</strong> das informações que o
          próprio Cliente teria em tela (por exemplo, as mensagens do chat do pregão). A Contratada{' '}
          <strong className={forte}>nunca</strong> usará essas credenciais para enviar lances, propostas,
          mensagens, recursos ou praticar qualquer outro ato em nome do Cliente. As credenciais são guardadas
          criptografadas e podem ser removidas pelo Cliente a qualquer momento. Cabe ao Cliente observar as
          regras de uso de cada portal.
        </p>
      </>
    ),
  },
  {
    titulo: '9. Confidencialidade',
    conteudo: (
      <>
        <p className="mb-3">
          <strong className={forte}>9.1. O que é confidencial.</strong> É &ldquo;Informação Confidencial&rdquo;
          toda informação não pública que uma Parte disponibilize à outra em razão destes Termos. Do lado do
          Cliente, inclui os Dados do Cliente, sua estratégia comercial, preços, propostas, credenciais, e{' '}
          <strong className={forte}>quais pregões, órgãos, produtos e concorrentes ele acompanha</strong>. Do
          lado da Contratada, inclui código-fonte, critérios internos de pontuação não publicados, documentação
          técnica e de segurança, roteiro de produto e condições comerciais negociadas.
        </p>
        <p className="mb-3">
          <strong className={forte}>9.2. O que não é.</strong> Não é confidencial a informação que (a) já seja
          pública ou se torne pública sem culpa da Parte que a recebeu — o que inclui os dados das fontes
          públicas oficiais exibidos na Plataforma; (b) já fosse legitimamente conhecida por quem a recebeu;
          (c) tenha sido recebida de terceiro sem dever de sigilo; ou (d) tenha sido desenvolvida de forma
          independente.
        </p>
        <p className="mb-3">
          <strong className={forte}>9.3. Obrigações.</strong> Cada Parte se obriga a (a) usar a Informação
          Confidencial da outra apenas para executar estes Termos; (b) protegê-la com o mesmo cuidado que dá às
          próprias, nunca inferior ao razoável; (c) dar acesso a ela apenas a empregados e prestadores que
          precisem conhecê-la e estejam vinculados a dever de sigilo equivalente; e (d) não divulgá-la a
          terceiros. Em particular, a Contratada <strong className={forte}>não revela a nenhum outro cliente
          nem a terceiros</strong> o que o Cliente pesquisa, monitora ou cadastra na Plataforma.
        </p>
        <p className="mb-3">
          <strong className={forte}>9.4. Divulgação obrigatória.</strong> A Parte obrigada por lei, ordem
          judicial ou de autoridade competente a revelar Informação Confidencial poderá fazê-lo na exata medida
          exigida, avisando previamente a outra Parte sempre que isso for legalmente permitido.
        </p>
        <p className="mb-3">
          <strong className={forte}>9.5. Prazo.</strong> As obrigações desta seção valem durante a relação e
          por <strong className={forte}>5 (cinco) anos</strong> após o seu término; quanto a credenciais e
          segredos de negócio, enquanto mantiverem essa natureza.
        </p>
        <p>
          <strong className={forte}>9.6. Dados agregados.</strong> A Contratada pode usar métricas de uso
          agregadas e anonimizadas, que não identifiquem o Cliente, seus usuários nem o que eles monitoram,
          exclusivamente para operar, proteger e melhorar a Plataforma.
        </p>
      </>
    ),
  },
  {
    titulo: '10. Proteção de dados pessoais (LGPD)',
    conteudo: (
      <>
        <p className="mb-3">
          <strong className={forte}>10.1. Papéis.</strong> O tratamento de dados pessoais observa a Lei
          nº 13.709/2018 (LGPD). Quanto aos dados dos usuários do Cliente necessários para cadastro,
          autenticação, cobrança e segurança, a Contratada atua como <strong className={forte}>controladora</strong>,
          nos termos da{' '}
          <Link href="/privacidade" className="text-accent hover:underline">Política de Privacidade</Link>. Quanto
          aos dados pessoais que o Cliente insere por conta própria (contatos no CRM, nomes em documentos e
          anotações), o Cliente é o <strong className={forte}>controlador</strong> e a Contratada atua como{' '}
          <strong className={forte}>operadora</strong>, tratando-os apenas para prestar o serviço, conforme
          estes Termos e as funcionalidades que o Cliente usa. Os dados pessoais presentes nas fontes públicas
          oficiais são tratados observando a finalidade, a boa-fé e o interesse público que justificaram sua
          disponibilização (art. 7º, § 3º, da LGPD).
        </p>
        <p className="mb-2"><strong className={forte}>10.2. A Contratada se obriga a:</strong></p>
        <ul className="list-disc pl-5 space-y-1.5 mb-3">
          <li>tratar os dados pessoais somente para as finalidades destes Termos e da Política de Privacidade;</li>
          <li>manter medidas de segurança técnicas e administrativas aptas a proteger os dados (art. 46 da LGPD), descritas na Política de Privacidade;</li>
          <li>exigir sigilo de todas as pessoas autorizadas a acessar os dados;</li>
          <li>usar apenas os suboperadores indicados na Política de Privacidade, com obrigações de proteção equivalentes;</li>
          <li>
            comunicar ao Cliente, sem demora injustificada e em até <strong className={forte}>2 (dois) dias
            úteis</strong> da ciência, incidente de segurança que possa acarretar risco ou dano relevante aos
            titulares dos Dados do Cliente, para que ele possa cumprir suas próprias comunicações à ANPD;
          </li>
          <li>auxiliar o Cliente, no que estiver ao seu alcance, a atender pedidos de titulares;</li>
          <li><strong className={forte}>não vender</strong> dados pessoais e não usá-los para treinar modelos de inteligência artificial;</li>
          <li>ao término da relação, eliminar ou devolver os Dados do Cliente conforme a seção 14, ressalvadas as retenções exigidas por lei.</li>
        </ul>
        <p className="mb-2"><strong className={forte}>10.3. O Cliente se obriga a:</strong></p>
        <ul className="list-disc pl-5 space-y-1.5 mb-3">
          <li>ter base legal para todo dado pessoal que inserir na Plataforma e informar seus titulares quando a lei exigir;</li>
          <li>não inserir dados pessoais sensíveis desnecessários, em especial dados de saúde de pacientes;</li>
          <li>garantir que seus usuários mantenham as credenciais em sigilo e usem a Plataforma conforme estes Termos;</li>
          <li>comunicar à Contratada, sem demora, qualquer incidente de segurança de seu lado que possa afetar a Plataforma.</li>
        </ul>
        <p>
          <strong className={forte}>10.4. Responsabilidade.</strong> Cada Parte responde pelos danos que causar
          em razão do descumprimento da LGPD, na medida de sua participação, nos termos dos arts. 42 a 45 da
          LGPD. Pedidos sobre dados pessoais podem ser enviados ao Encarregado da Contratada:{' '}
          <a href={`mailto:${DPO_EMAIL}`} className="text-accent hover:underline font-mono-custom">{DPO_EMAIL}</a>.
        </p>
      </>
    ),
  },
  {
    titulo: '11. Disponibilidade e manutenção',
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
    titulo: '12. Limitação de responsabilidade',
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
    titulo: '13. Indenização',
    conteudo: (
      <p>
        Cada Parte manterá a outra indene de reclamações, multas e condenações de terceiros — incluindo
        titulares de dados e autoridades — que decorram comprovadamente de seu próprio descumprimento destes
        Termos ou da lei: do lado do Cliente, em especial o uso vedado na seção 7 e a inserção de dados sem
        base legal; do lado da Contratada, em especial a violação da seção 9 ou de suas obrigações de segurança
        da seção 10, observado o limite da seção 12. A Parte acionada deve avisar a outra prontamente e
        permitir que ela participe da defesa.
      </p>
    ),
  },
  {
    titulo: '14. Suspensão e encerramento',
    conteudo: (
      <p>
        A Contratada pode suspender ou encerrar o acesso, mediante aviso, em caso de descumprimento destes
        Termos, inadimplência ou uso que ameace a segurança da Plataforma. Encerrada a conta, o Cliente pode
        solicitar a exportação de seus dados em até 30 dias, findos os quais eles poderão ser eliminados ou
        anonimizados, observados os prazos legais de retenção previstos na Política de Privacidade. As seções
        9 (Confidencialidade), 10 (Proteção de dados), 12 (Limitação de responsabilidade), 13 (Indenização) e
        17 (Foro) continuam valendo após o encerramento.
      </p>
    ),
  },
  {
    titulo: '15. Alterações destes Termos',
    conteudo: (
      <p>
        Estes Termos podem ser atualizados para refletir mudanças legais ou do serviço. A data e a versão da
        última revisão são indicadas no topo desta página, e alterações relevantes serão comunicadas pelos
        canais da Plataforma com antecedência razoável, podendo ser exigido novo aceite. O uso após a vigência
        da nova versão significa concordância com ela; quem não concordar pode cancelar sem ônus.
      </p>
    ),
  },
  {
    titulo: '16. Aceite eletrônico e registro',
    conteudo: (
      <p>
        O aceite destes Termos e da Política de Privacidade é feito eletronicamente, pela marcação da opção{' '}
        <strong className={forte}>&ldquo;Li e estou de acordo&rdquo;</strong> no cadastro, no aceite de
        convite ou na contratação, e tem a mesma validade de uma assinatura (art. 10, § 2º, da MP
        nº 2.200-2/2001 e art. 107 do Código Civil). Para fins de prova, a Contratada registra a versão
        aceita de cada documento, a data e a hora e o endereço IP de quem aceitou. Quem aceita em nome de
        pessoa jurídica declara ter poderes para obrigá-la.
      </p>
    ),
  },
  {
    titulo: '17. Legislação aplicável e foro',
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
