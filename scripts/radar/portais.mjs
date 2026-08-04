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
    // Página onde o humano faz o login (gov.br).
    loginUrl: 'https://www.gov.br/compras/pt-br/acesso-ao-sistema',
    // Área autenticada de acompanhamento (destino após o login).
    areaUrl: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/acompanhamento',
    emLogin: ({ url }) => /acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url),
    // ATENÇÃO: URL NÃO basta aqui. O Compras.gov.br é uma SPA Angular e responde
    // HTTP 200 com o HTML de bootstrap na própria URL da área logada — só depois de
    // carregar o app é que ele manda para o gov.br. Checando só a URL, a captura
    // declarava "conectado" 6 s depois de abrir, sem login (medido em 2026-08-04:
    // sessão resultante só tinha cookies do Google Analytics). Então exige também
    // sinal de sessão no conteúdo já renderizado, e o `capture.mjs` ainda confere se
    // o storage_state tem cookie/token de verdade.
    logado: ({ url, conteudo }) =>
      /comprasnet-web\/seguro/.test(url) &&
      !/acesso\.gov\.br|sso\.|\/login|autenticacao/i.test(url) &&
      /(sair|encerrar\s*sess|meus?\s*dados|minhas?\s*(compras|licita)|cpf|cnpj)/i.test(conteudo || ''),
  },
  pcp: {
    id: 'pcp',
    nome: 'Portal de Compras Públicas',
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
  bll: {
    id: 'bll',
    nome: 'BLL — Bolsa de Licitações e Leilões',
    loginUrl: 'https://bllcompras.com/Account/Login',
    areaUrl: 'https://bllcompras.com/',
    emLogin: ({ url }) => /account\/login|\/login/i.test(url),
    logado: ({ url, conteudo }) => !/\/login/i.test(url) && /(sair|logout|painel)/i.test(conteudo || ''),
  },
}

/** Meta de um portal (fallback: comprasgov, o único totalmente calibrado). */
export function portalMeta(id) {
  return PORTAIS[id] ?? PORTAIS.comprasgov
}
