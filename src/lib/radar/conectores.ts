// src/lib/radar/conectores.ts — CATÁLOGO de portais do Radar (fonte única para a UI).
// Módulo PURO (sem DB): usado no cliente (picker de portal, rótulos de saúde) e
// espelhado no seed do banco (db/schema-radar.sql) + no worker (scripts/radar).
//
// `disponivel` = dá para monitorar o chat ponta-a-ponta.
// `modoPublico` = o portal publica o andamento do processo SEM login (o Radar lê a
//   página pública; não pede credencial). É o caso do PCP: monitoramos o andamento
//   (convocação, habilitação, recurso, prazo, homologação) de graça; a sessão do
//   próprio cliente só é necessária para a sala AO VIVO (lances em tempo real).
// Compras.gov.br usa captura de sessão (login gov.br). PCP, BLL, BNC, Licitanet,
// AMM Licita e Licitações-e são públicos.

export interface Conector {
  id: string
  nome: string
  descricao: string
  disponivel: boolean
  /** Monitora pela página pública, sem exigir login. */
  modoPublico?: boolean
  /** Trecho do host do `link_externo` quando a licitação corre neste portal. */
  dominio?: string
  /** Prefixo que o PNCP põe no objeto quando a licitação corre neste portal. */
  marcaObjeto?: string
}

export const CONECTORES: Conector[] = [
  {
    id: 'comprasgov',
    nome: 'Compras.gov.br',
    descricao: 'Portal federal (ex-ComprasNet). Login via gov.br.',
    disponivel: true,
  },
  {
    id: 'pcp',
    nome: 'Portal de Compras Públicas',
    descricao: 'Prefeituras, consórcios e órgãos estaduais. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'portaldecompraspublicas',
    // O PNCP preserva o prefixo do portal no objeto ("[Portal de Compras Públicas] - …").
    // Medido na base: 19.023 licitações trazem essa marca contra só 530 com o link —
    // é de longe o sinal mais presente de que o pregão corre no PCP.
    marcaObjeto: '[portal de compras públicas]',
  },
  // O Único conector que NÃO abre navegador: o Licitações-e novo
  // (licitacoes-e2.bb.com.br) é um Angular sobre API REST pública, sem token nem
  // cookie. Duas chamadas de JSON por processo no lugar de ~12 s de Chromium.
  //
  // E o que ele entrega NÃO É CHAT — este portal não tem mensageria pública
  // (conferido até num processo com `exibirMensageria: true`). O que abre para quem
  // não é participante é o DOSSIÊ: a situação do certame e cada peça anexada com
  // carimbo de hora — impugnação e pedido de esclarecimento de concorrente inclusive.
  // A descrição abaixo promete isso e nada além.
  {
    id: 'licitacoes-e',
    nome: 'Licitações-e (Banco do Brasil)',
    descricao: 'Pregões do portal do BB. Lemos o dossiê público — situação do certame, impugnações e pedidos de esclarecimento, com hora. Não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'licitacoes-e2.bb.com.br',
  },
  // BLL e BNC são a MESMA aplicação em dois domínios — mesma rota de processo, mesmas
  // abas, mesmo quadro de mensagens (medido em 13/09/2026 nos dois, sem cookie). Um
  // conector só atende os dois no worker (scripts/radar/connector-bll.mjs); os ids ficam
  // separados para o cliente ler o nome do portal onde o pregão realmente corre.
  //
  // O que entra por aqui é o LOG PÚBLICO do processo (arquivo novo, troca de pregoeiro,
  // suspensão/retomada, alteração de disputa). A sala de lances AO VIVO continua exigindo
  // a sessão do próprio fornecedor e NÃO é lida.
  {
    id: 'bll',
    nome: 'BLL — Bolsa de Licitações e Leilões',
    descricao: 'Portal privado usado por muitos municípios. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'bllcompras',
  },
  // O painel de mensagens do Licitanet é o mais rico dos portais públicos ligados até
  // aqui: suspensão com data de reabertura, intenção de recurso com prazo, revogação,
  // prorrogação de disputa. Tudo com o prazo escrito dentro do texto.
  {
    id: 'licitanet',
    nome: 'Licitanet',
    descricao: 'Sessão pública com a comunicação do certame. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'licitanet',
  },
  // AMM Licita roda a mesma aplicação do Licitar Digital. Só ela entra no catálogo: o
  // domínio do Licitar Digital responde com o desafio de robô da Cloudflare, e contornar
  // isso está fora de questão. Se um dia abrir, é só acrescentar o id aqui — o conector
  // (scripts/radar/connector-ammlicita.mjs) já serve aos dois.
  {
    id: 'ammlicita',
    nome: 'AMM Licita',
    descricao: 'Impugnações, esclarecimentos, recursos e avisos do condutor. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'ammlicita',
  },
  {
    id: 'bnc',
    nome: 'BNC — Bolsa Nacional de Compras',
    descricao: 'Mesma plataforma do BLL, em outro domínio. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'bnccompras',
  },
  // eGov RS: Compras RS e Pregão Banrisul são a MESMA aplicação em dois domínios (o
  // segundo é a fachada usada por municípios gaúchos), com a mesma rota de edital
  // (/editais/<numero>_<ano>/<id>) — o mesmo caso do BLL/BNC. Um conector só atende os
  // dois (scripts/radar/connector-egovrs.mjs); os ids ficam separados para o cliente ler
  // o nome do portal onde o pregão realmente corre.
  //
  // O que entra é a ATA DE ESCLARECIMENTOS E IMPUGNAÇÕES: pergunta e resposta na íntegra,
  // quem respondeu, quando, e o julgamento da impugnação (Negado/Deferido). É o conteúdo
  // mais decisivo dos portais públicos ligados até aqui — muda proposta, não só avisa.
  //
  // A sessão de lances ("Ata Eletrônica") está atrás de um desafio anti-robô declarado
  // pelo próprio portal e NÃO é lida.
  {
    id: 'egovrs',
    nome: 'Compras RS',
    descricao: 'Esclarecimentos e impugnações com a resposta na íntegra. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'compras.rs.gov.br',
  },
  {
    id: 'banrisul',
    nome: 'Pregão Banrisul',
    descricao: 'Mesma plataforma do Compras RS, usada por municípios gaúchos. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'pregaobanrisul',
  },
  // Compras BR (AZ Tecnologia): API REST pública, sem token. Único portal ligado em que
  // o link do PNCP NÃO é lido — a página redireciona para a home e o conteúdo vive num
  // iframe; o conector fala direto com a API que esse iframe consome.
  //
  // Melhor aproveitamento medido (36% dos processos têm pedido registrado, contra 16% do
  // eGov RS), mas o teor da pergunta e da resposta fica em PDF: entram o ASSUNTO, o tipo,
  // a situação e o nome do anexo — mais a situação do processo quando ela é ruptura
  // (suspenso, revogado, anulado…).
  {
    id: 'comprasbr',
    nome: 'Compras BR',
    descricao: 'Esclarecimentos, impugnações e suspensões do processo. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    modoPublico: true,
    dominio: 'comprasbr.com.br',
  },
]

const POR_ID = new Map(CONECTORES.map((c) => [c.id, c]))

/** Nome amigável de um conector pelo id (fallback: o próprio id). */
export function nomeConector(id: string): string {
  return POR_ID.get(id)?.nome ?? id
}

export function conectorDisponivel(id: string): boolean {
  return POR_ID.get(id)?.disponivel ?? false
}

/** Portal monitorado pela página pública (sem login/credencial). */
export function conectorPublico(id: string): boolean {
  return POR_ID.get(id)?.modoPublico ?? false
}

/**
 * A licitação corre NESTE portal?
 *
 * Vale só para os conectores de modo público, e existe para não atribuir a eles
 * pregão que não é deles. Um conector com login enxerga os processos do próprio
 * cliente; um conector público precisa achar a PÁGINA do processo — se o pregão
 * corre no BB ou no Comprasnet, essa página não existe no PCP e a busca só devolve
 * "sem match confiável", batendo na API do portal para nada.
 */
export function licitacaoDoPortal(
  conectorId: string,
  lic: { objeto_compra?: string | null; link_externo?: string | null },
): boolean {
  const c = POR_ID.get(conectorId)
  if (!c) return false
  const link = (lic.link_externo ?? '').toLowerCase()
  if (c.dominio && link.includes(c.dominio)) return true
  const objeto = (lic.objeto_compra ?? '').trim().toLowerCase()
  return !!c.marcaObjeto && objeto.startsWith(c.marcaObjeto)
}
