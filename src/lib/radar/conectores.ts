// src/lib/radar/conectores.ts — CATÁLOGO de portais do Radar (fonte única para a UI).
// Módulo PURO (sem DB): usado no cliente (picker de portal, rótulos de saúde) e
// espelhado no seed do banco (db/schema-radar.sql) + no worker (scripts/radar).
//
// `disponivel` = dá para monitorar o chat ponta-a-ponta.
// `modoPublico` = o portal publica o andamento do processo SEM login (o Radar lê a
//   página pública; não pede credencial). É o caso do PCP: monitoramos o andamento
//   (convocação, habilitação, recurso, prazo, homologação) de graça; a sessão do
//   próprio cliente só é necessária para a sala AO VIVO (lances em tempo real).
// Compras.gov.br lê o painel público de mensagens. PCP, BLL, BNC, Licitanet,
// AMM Licita e Licitações-e são públicos.

export interface Conector {
  id: string
  nome: string
  descricao: string
  disponivel: boolean
  /**
   * O QUE O CONECTOR LÊ NESTE PORTAL — e é obrigatório de propósito.
   *
   *   'chat'   → quadro de mensagens do certame (pregoeiro × fornecedor × sistema)
   *   'dossie' → peças e andamento publicados (impugnações, atas, anexos, log)
   *
   * Isto decide a FRASE do e-mail de alerta (`enviarAlertaRadar`). Estava cravado
   * como um `if (conector_id === 'licitacoes-e')` dentro do cron de notificação —
   * e o Licitações-e não é o único portal sem chat: BLL, BNC, eGov RS, Banrisul e
   * Compras BR também leem peças, não conversa. Os cinco prometiam "nova mensagem
   * no chat" para quem só recebe documento.
   *
   * Sem tipo obrigatório, ligar o próximo portal público exigiria LEMBRAR de editar
   * um ternário num cron de e-mail — e esquecer não quebra nada, só volta a
   * prometer chat. Aqui o compilador cobra a decisão.
   */
  leitura: 'chat' | 'dossie'
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
    descricao: 'Piloto de mensagens públicas, sem tarifa de API. Pode exigir CAPTCHA manual no modo assistido. Conteúdo restrito não está incluído.',
    disponivel: true,
    modoPublico: true,
    leitura: 'chat',
  },
  {
    id: 'pcp',
    nome: 'Portal de Compras Públicas',
    descricao: 'Prefeituras, consórcios e órgãos estaduais. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    leitura: 'chat', // comunicação da sessão: negociação, prazo de recurso, motivo de desclassificação
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
  //
  // DESLIGADO À ESPERA DE UMA REQUISIÇÃO REAL QUE COMPLETE.
  //
  // O conector está inteiro e testado — 58 asserções, incluindo os caminhos de recusa,
  // bloqueio com 200, envelope de erro e queda de transporte. O que NUNCA aconteceu foi
  // uma chamada bem-sucedida: o BB responde 403 à máquina do coletor e também a outras
  // redes testadas, então o método (POST, lido do tráfego do próprio portal) jamais foi
  // confirmado contra o portal vivo.
  //
  // Ligar é trocar esta linha para `true`. A partir daí a seleção passa a criar
  // processos (85 abertos hoje na Bahia, 41 no RS) e o coletor passa a bater no BB — e,
  // se o método estiver errado, o Radar diz `portal_indisponivel` ou `falha` com o
  // motivo, nunca "sem novidades". A espera não é por segurança do dado; é para não
  // anunciar ao cliente um portal que ninguém viu funcionar.
  {
    id: 'licitacoes-e',
    nome: 'Licitações-e (Banco do Brasil)',
    descricao: 'Pregões do portal do BB. Lemos o dossiê público — situação do certame, impugnações e pedidos de esclarecimento, com hora. Não pede senha.',
    disponivel: false,
    leitura: 'dossie', // não tem mensageria pública — só situação e anexos
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
    leitura: 'dossie', // log público do processo; a sala ao vivo exige a sessão do fornecedor
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
    leitura: 'chat', // painel "Comunicação da sessão", com prazo dentro do texto
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
    leitura: 'dossie', // impugnações, esclarecimentos e avisos publicados
    modoPublico: true,
    dominio: 'ammlicita',
  },
  {
    id: 'bnc',
    nome: 'BNC — Bolsa Nacional de Compras',
    descricao: 'Mesma plataforma do BLL, em outro domínio. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    leitura: 'dossie', // mesma aplicação do BLL — log público
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
    leitura: 'dossie', // ata de esclarecimentos e impugnações
    modoPublico: true,
    dominio: 'compras.rs.gov.br',
  },
  {
    id: 'banrisul',
    nome: 'Pregão Banrisul',
    descricao: 'Mesma plataforma do Compras RS, usada por municípios gaúchos. Lemos a página pública do processo — não pede senha.',
    disponivel: true,
    leitura: 'dossie', // mesma aplicação do Compras RS
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
    leitura: 'dossie', // esclarecimentos, impugnações e suspensões; teor em PDF
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
  if (conectorId === 'comprasgov') {
    try {
      const url = new URL(lic.link_externo ?? '')
      return ['http:', 'https:'].includes(url.protocol) &&
        (url.hostname === 'cnetmobile.estaleiro.serpro.gov.br' ||
         ['comprasnet.gov.br', 'compras.gov.br'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
    } catch { return false }
  }
  const link = (lic.link_externo ?? '').toLowerCase()
  if (c.dominio && link.includes(c.dominio)) return true
  const objeto = (lic.objeto_compra ?? '').trim().toLowerCase()
  return !!c.marcaObjeto && objeto.startsWith(c.marcaObjeto)
}

/**
 * A frase do alerta: este portal entrega conversa ou peça?
 *
 * Default 'dossie' para id desconhecido — prometer menos do que se entrega é o erro
 * barato; prometer chat onde só há documento é o que o requisito 4.2 proíbe.
 */
export function leituraDoConector(conectorId: string | null | undefined): 'chat' | 'dossie' {
  return POR_ID.get(String(conectorId ?? ''))?.leitura ?? 'dossie'
}
