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
  'licitacoes-e': {
    id: 'licitacoes-e',
    nome: 'Licitações-e (Banco do Brasil)',
    loginUrl: 'https://www.licitacoes-e.com.br/aop/index-login.aop',
    areaUrl: 'https://www.licitacoes-e.com.br/aop/',
    emLogin: ({ url }) => /login/i.test(url),
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
