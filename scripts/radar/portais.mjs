// scripts/radar/portais.mjs — REGISTRO por portal (login + área autenticada + como
// detectar "logado"). Fonte única que torna a captura de sessão PORTAL-AGNÓSTICA:
// o operador/worker abre `loginUrl`, a pessoa loga, e detectamos o sucesso pelo
// `logado({url, conteudo})`. Adicionar um portal = acrescentar uma entrada aqui + um
// connector-<id>.mjs. (A extração do chat fica no connector; aqui é só a SESSÃO.)
//
// OBS.: markers do PCP são PROVISÓRIOS até a calibração com uma conta real
// (scripts/radar/calibrate-pcp.mjs) — por isso o conector falha de forma HONESTA
// enquanto não confirmarmos.

export const PORTAIS = {
  comprasgov: {
    id: 'comprasgov',
    nome: 'Compras.gov.br',
    // Página onde o humano faz o login. É a TELA DE LOGIN em si, não a página
    // institucional de "acesso ao sistema" — o fornecedor não deve ter de caçar um
    // botão dentro de um iframe. Confirmado em 13/09/2026: título "Faça o Login no
    // Compras.gov.br", e a URL casa com `emLogin` logo abaixo.
    //
    // NÃO use aqui a `areaUrl`: a SPA não redireciona para o login quem chega sem
    // sessão — ela mostra "Página não encontrada" ou "Acesso não autorizado", e o
    // fornecedor fica olhando um erro dentro do iframe sem saber o que fazer.
    loginUrl: 'https://www.comprasnet.gov.br/seguro/loginPortal.asp',
    // Área autenticada do fornecedor (destino após o login).
    //
    // NÃO É o `cnetmobile` (comprasnet-web). Duas rotas já foram tentadas ali e as duas
    // falharam, por motivos DIFERENTES:
    //   /seguro/acompanhamento → "Página não encontrada" (a rota não existe mais; a
    //     tabela de rotas do Angular lista só public · seguro/fornecedor ·
    //     seguro/governo · pagina-nao-encontrada · iniciar-sessao ·
    //     acesso-nao-autorizado · sessao-encerrada)
    //   /seguro/fornecedor → "Acesso não autorizado" MESMO com sessão gov.br válida,
    //     medido em 13/09/2026 com um login real recém-concluído (4 cookies de
    //     autenticação no sso.acesso.gov.br). A própria página diz o porquê: "tente
    //     realizar o acesso A PARTIR DO Compras.gov.br". O cnetmobile não aceita link
    //     direto — ele exige o repasse vindo de dentro do portal, e por isso NENHUM
    //     cookie é emitido para aquele domínio quando se chega por fora.
    //
    // A área de trabalho do fornecedor continua sendo o ASP clássico do comprasnet, e é
    // lá que ficam Acompanhar Julgamento, Avisos e as mensagens do certame. Chegamos
    // aqui seguindo o menu do portal logado (t_top.asp → /assinadas/pregao.asp), não
    // adivinhando: é o próprio portal que informa a rota.
    areaUrl: 'https://www.comprasnet.gov.br/pregao/fornec/pregao1.asp',
    emLogin: ({ url }) => /acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url),
    // ATENÇÃO: URL NÃO basta aqui. O Compras.gov.br é uma SPA Angular e responde
    // HTTP 200 com o HTML de bootstrap na própria URL da área logada — só depois de
    // carregar o app é que ele manda para o gov.br. Checando só a URL, a captura
    // declarava "conectado" 6 s depois de abrir, sem login (medido em 2026-08-04:
    // sessão resultante só tinha cookies do Google Analytics). Então exige também
    // sinal de sessão no conteúdo já renderizado, e o `capture.mjs` ainda confere se
    // o storage_state tem cookie/token de verdade.
    logado: ({ url, conteudo }) =>
      /comprasnet\.gov\.br/i.test(url) &&
      !/acesso\.gov\.br|sso\.|loginPortal|\/login|autenticacao/i.test(url) &&
      // Marcadores lidos da área REAL, com uma sessão real aberta (13/09/2026):
      // "Área de Trabalho do Fornecedor Brasileiro" no topo, e na página do pregão
      // "Pregão/Concorrência Eletrônica" + "Acompanhar Julgamento/Habilitação".
      // Sem acento também, porque o conteúdo chega minúsculo e às vezes sem acentuação.
      /(área|area)\s*de\s*trabalho\s*do\s*fornecedor|(pregão|pregao)\/(concorrência|concorrencia)|acompanhar\s*julgamento/i.test(
        conteudo || '',
      ),
  },
  pcp: {
    id: 'pcp',
    nome: 'Portal de Compras Públicas',
    publico: true,
    dominio: 'portaldecompraspublicas',
    loginUrl: 'https://www.portaldecompraspublicas.com.br/Login',
    // Painel do fornecedor após o login (a calibrar).
    areaUrl: 'https://www.portaldecompraspublicas.com.br/Home',
    emLogin: ({ url }) => /\/login/i.test(url),
    // Heurística: saiu do /login e apareceu um vínculo de sessão (Sair/painel).
    logado: ({ url, conteudo }) =>
      !/\/login/i.test(url) && /(sair|logout|meu\s*painel|minhas\s*licita|área\s*do\s*fornecedor|painel\s*do\s*fornecedor)/i.test(conteudo || ''),
  },
  // Licitações-e: lido pela API PÚBLICA do portal NOVO
  // (licitacoes-e2.bb.com.br), sem login e sem navegador — ver
  // connector-licitacoes-e.mjs.
  //
  // O `loginUrl` antigo apontava para `www.licitacoes-e.com.br/aop/index-login.aop`,
  // que hoje responde 403 e, mesmo quando respondia, era servido atrás do Módulo de
  // Segurança do BB (Warsaw/GAS) — atestação NATIVA de dispositivo, que navegador em
  // container não passa e que não se contorna. Mandar o cliente para lá era mandá-lo
  // para uma porta que não abre; agora aponta para o portal vivo.
  'licitacoes-e': {
    id: 'licitacoes-e',
    nome: 'Licitações-e (Banco do Brasil)',
    publico: true,
    dominio: 'licitacoes-e2.bb.com.br',
    loginUrl: 'https://licitacoes-e2.bb.com.br/aop-inter-estatico/',
    areaUrl: 'https://licitacoes-e2.bb.com.br/aop-inter-estatico/',
    emLogin: ({ url }) => /login|acesso/i.test(url),
    logado: ({ url, conteudo }) => !/login/i.test(url) && /(sair|encerrar\s*sess|minhas\s*licita)/i.test(conteudo || ''),
  },
  // BLL e BNC: MESMA aplicação em dois domínios (medido em 13/09/2026 — mesma rota
  // /Process/ProcessView, mesmas abas, mesmo `#MsgProcess`). Um conector só atende os
  // dois (connector-bll.mjs), mas os ids são separados para o cliente ver o nome certo
  // do portal onde o pregão corre.
  //
  // São PÚBLICOS: o log do processo abre sem cookie nenhum. `loginUrl`/`areaUrl` ficam
  // registrados para a etapa da sala de disputa AO VIVO, que aí sim exige a sessão do
  // fornecedor — e que este conector NÃO tenta ler.
  bll: {
    id: 'bll',
    nome: 'BLL — Bolsa de Licitações e Leilões',
    publico: true,
    dominio: 'bllcompras',
    loginUrl: 'https://bllcompras.com/Account/Login',
    areaUrl: 'https://bllcompras.com/',
    emLogin: ({ url }) => /account\/login|\/login/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
  // Licitanet: a sessão pública (/sessao/<id>) mostra a comunicação do certame para
  // qualquer um. Não tem área logada envolvida na leitura — `loginUrl` fica só para a
  // sala de disputa do fornecedor, que este conector NÃO lê.
  licitanet: {
    id: 'licitanet',
    nome: 'Licitanet',
    publico: true,
    dominio: 'licitanet',
    loginUrl: 'https://licitanet.com.br/',
    areaUrl: 'https://licitanet.com.br/',
    emLogin: ({ url }) => /\/login|\/entrar/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
  // AMM Licita: mesma aplicação do Licitar Digital (rota /pesquisa/<id>), no domínio que
  // NÃO está atrás da Cloudflare. Só este entra — o gêmeo fica de fora enquanto exigir
  // desafio de robô, porque o Radar não contorna proteção de robô.
  ammlicita: {
    id: 'ammlicita',
    nome: 'AMM Licita',
    publico: true,
    dominio: 'ammlicita',
    loginUrl: 'https://app2.ammlicita.org.br/',
    areaUrl: 'https://app2.ammlicita.org.br/',
    emLogin: ({ url }) => /\/login|\/entrar/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
  bnc: {
    id: 'bnc',
    nome: 'BNC — Bolsa Nacional de Compras',
    publico: true,
    dominio: 'bnccompras',
    loginUrl: 'https://bnccompras.com/Account/Login',
    areaUrl: 'https://bnccompras.com/',
    emLogin: ({ url }) => /account\/login|\/login/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
  // eGov RS (Compras RS) e Pregão Banrisul: mesma aplicação, dois domínios. A ata de
  // esclarecimentos e impugnações é PÚBLICA — 37 de 37 processos sondados em 15/09/2026
  // responderam 200 sem cookie nenhum. `loginUrl`/`areaUrl` ficam registrados só para a
  // área do fornecedor, que este conector NÃO lê.
  egovrs: {
    id: 'egovrs',
    nome: 'Compras RS',
    publico: true,
    dominio: 'compras.rs.gov.br',
    loginUrl: 'https://www.compras.rs.gov.br/',
    areaUrl: 'https://www.compras.rs.gov.br/',
    emLogin: ({ url }) => /\/login|\/entrar|autentica/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
  banrisul: {
    id: 'banrisul',
    nome: 'Pregão Banrisul',
    publico: true,
    dominio: 'pregaobanrisul',
    loginUrl: 'https://pregaobanrisul.com.br/',
    areaUrl: 'https://pregaobanrisul.com.br/',
    emLogin: ({ url }) => /\/login|\/entrar|autentica/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
  // Compras BR: o `dominio` casa o link que o PNCP publica (comprasbr.com.br/
  // pregao-eletronico-detalhe/?idlicitacao=<id>), mas o conector NÃO abre essa página —
  // ela redireciona para a home. Quem serve o conteúdo é a API em app.comprasbr.com.br,
  // que o próprio iframe da página consome. Ver connector-comprasbr.mjs.
  comprasbr: {
    id: 'comprasbr',
    nome: 'Compras BR',
    publico: true,
    dominio: 'comprasbr.com.br',
    loginUrl: 'https://comprasbr.com.br/',
    areaUrl: 'https://comprasbr.com.br/',
    emLogin: ({ url }) => /\/login|\/entrar|autentica/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
}

/** Meta de um portal (fallback: comprasgov, o único totalmente calibrado). */
export function portalMeta(id) {
  return PORTAIS[id] ?? PORTAIS.comprasgov
}

/**
 * Ids dos portais lidos pela página PÚBLICA (sem credencial). O worker usa esta lista
 * para saber em quem rodar a passada pública — antes o 'pcp' estava escrito na mão
 * dentro do run.mjs, e acrescentar um portal público significava editar o orquestrador.
 *
 * Espelha `modoPublico` de src/lib/radar/conectores.ts (o catálogo da UI). São dois
 * arquivos porque um é TypeScript do app e o outro é ESM do worker; divergir aqui faz o
 * Radar selecionar processo que ninguém lê, ou ler processo que ninguém selecionou.
 */
export const PORTAIS_PUBLICOS = Object.values(PORTAIS).filter((p) => p.publico).map((p) => p.id)
