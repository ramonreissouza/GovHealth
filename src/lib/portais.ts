// src/lib/portais.ts — IDENTIFICAÇÃO do portal em que a licitação acontece.
// Módulo PURO (sem DB): usado no server (APIs) e no client (selo do portal).
//
// Não confundir com scripts/radar/portais.mjs, que trata de SESSÃO/login para a
// captura de chat. Aqui é só "que portal é este?", a partir do que o PNCP entrega.
//
// Por que isso existe: o PNCP é o agregador nacional, mas a SESSÃO do pregão roda
// no portal do comprador (Licitanet, BNC, BLL, Compras.gov, Licitações-e, PCP e
// centenas de portais municipais). O PNCP informa isso em `linkSistemaOrigem`
// (URL do portal) e `usuarioNome` (nome do sistema). Enquanto o histórico não for
// re-processado, o marcador "[LICITANET] - ..." no início do objeto ainda recupera
// boa parte dos registros antigos.

export interface Portal {
  id: string
  nome: string
  /** Domínios que identificam o portal em linkSistemaOrigem. */
  dominios: string[]
  /** Marcas que aparecem como "[MARCA] - ..." no objeto ou em usuarioNome. */
  marcas?: string[]
  /**
   * O que o link realmente é. Medido em 13/08/2026 nos hosts não reconhecidos:
   * boa parte do que o PNCP manda em `linkSistemaOrigem` NÃO é portal de disputa,
   * é o portal de transparência do próprio município — a URL leva a onde se LÊ o
   * edital, não a onde a sessão acontece (ex.: `transparencia.agilicloud.com.br/
   * prefjuruena-mt/licitacoes/...`). Dizer "a disputa acontece aqui" nesses casos
   * seria falso, então quem for afirmar isso na UI deve filtrar por 'disputa'.
   * Ausente = não classificado (não afirme nada).
   */
  tipo?: 'disputa' | 'transparencia'
}

// Catálogo dos portais já observados nos dados do PNCP. Acrescentar portal = uma
// entrada aqui (a UI e os filtros passam a reconhecê-lo automaticamente).
//
// A ORDEM IMPORTA: `portalPorUrl` devolve o PRIMEIRO que casar, e o casamento
// inclui `h.includes(d)`. Entradas específicas primeiro, genéricas por último —
// o curinga de `.gov.br` fecha a lista de propósito.
export const PORTAIS: Portal[] = [
  // ── Disputa nacional ──────────────────────────────────────────────────────
  { id: 'comprasgov', nome: 'Compras.gov.br', tipo: 'disputa',
    // `comprasgovernamentais.gov.br` é o mesmo Compras.gov com outro domínio:
    // 635 registros estavam caindo em "não informado" só por isso.
    dominios: ['cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'gov.br/compras', 'compras.gov.br', 'comprasgovernamentais.gov.br'],
    marcas: ['compras.gov', 'comprasnet', 'compras.gov.br'] },
  // `tipo: 'disputa'` explícito em TODOS: sem ele, ePortalDeDisputa() devolvia
  // false e a UI dizia "Ver no Licitanet" em vez de "Disputa no Licitanet" —
  // justamente nos portais que mais importam. Pego pelo caso 1 de _t.ts.
  { id: 'licitanet', nome: 'Licitanet', tipo: 'disputa',
    dominios: ['licitanet.com.br'], marcas: ['licitanet'] },
  { id: 'bnc', nome: 'BNC — Bolsa Nacional de Compras', tipo: 'disputa',
    dominios: ['bnccompras.com', 'bnc.org.br'], marcas: ['bnc', 'bolsa nacional'] },
  { id: 'bll', nome: 'BLL — Bolsa de Licitações e Leilões', tipo: 'disputa',
    dominios: ['bllcompras.com', 'bllcompras.org.br', 'bll.org.br'], marcas: ['bll'] },
  { id: 'licitacoes-e', nome: 'Licitações-e (Banco do Brasil)', tipo: 'disputa',
    dominios: ['licitacoes-e.com.br', 'licitacoes-e2.bb.com.br', 'bb.com.br'], marcas: ['licitacoes-e', 'licitações-e', 'banco do brasil'] },
  { id: 'pcp', nome: 'Portal de Compras Públicas', tipo: 'disputa',
    dominios: ['portaldecompraspublicas.com.br'], marcas: ['portal de compras publicas', 'pcp'] },
  { id: 'licitamaisbrasil', nome: 'Licita Mais Brasil', tipo: 'disputa',
    dominios: ['licitamaisbrasil.com.br'], marcas: ['licita mais brasil'] },
  { id: 'licitardigital', nome: 'Licitar Digital', tipo: 'disputa',
    dominios: ['licitardigital.com.br', 'app2.licitardigital.com.br'], marcas: ['licitar digital'] },
  { id: 'ammlicita', nome: 'AMM Licita', tipo: 'disputa',
    dominios: ['ammlicita.org.br', 'app2.ammlicita.org.br'], marcas: ['amm licita'] },
  { id: 'sigep', nome: 'SIGEP', tipo: 'disputa',
    dominios: ['sigep.com.br'], marcas: ['sigep'] },
  { id: 'publicenter', nome: 'Publicenter', tipo: 'disputa',
    dominios: ['publicenter.com.br'], marcas: ['publicenter'] },
  { id: 'banrisul', nome: 'Pregão Banrisul', tipo: 'disputa',
    dominios: ['pregaobanrisul.com.br'], marcas: ['banrisul', 'procergs'] },
  { id: 'm2a', nome: 'M2A Tecnologia', tipo: 'disputa',
    dominios: ['compras.m2atecnologia.com.br', 'm2atecnologia.com.br'], marcas: ['m2a'] },
  { id: 'siga', nome: 'SIGA', tipo: 'disputa',
    dominios: ['siga.pr.gov.br'], marcas: ['siga'] },
  { id: 'comprasbr', nome: 'Compras BR',
    dominios: ['comprasbr.com.br'], marcas: ['compras br', 'comprasbr'], tipo: 'disputa' },

  // ── Disputa estadual ──────────────────────────────────────────────────────
  // Sistemas próprios de estado, onde a sessão roda de verdade (a WaveCode vende
  // CELIC/RS e Procergs pelo mesmo motivo). `host()` já tira o prefixo `www\d?.`,
  // então `www1.compras.mg.gov.br` casa com `compras.mg.gov.br`.
  //
  // Os nomes seguem `lib/portais-estaduais.ts` (PORTAIS_CONFIG) de propósito: o
  // mesmo portal com dois nomes diferentes em duas telas é defeito, e aquele
  // módulo já é exibido na página /estados.
  { id: 'compras-rj', nome: 'SIGA-RJ', tipo: 'disputa',
    dominios: ['compras.rj.gov.br'], marcas: ['siga-rj', 'compras.rj'] },
  { id: 'compras-mg', nome: 'LicitaMG', tipo: 'disputa',
    dominios: ['compras.mg.gov.br'], marcas: ['licitamg', 'compras.mg'] },
  { id: 'celic-rs', nome: 'Compras RS', tipo: 'disputa',
    dominios: ['compras.rs.gov.br', 'celic.rs.gov.br'], marcas: ['celic', 'compras.rs'] },
  { id: 'pe-integrado', nome: 'Compras PE', tipo: 'disputa',
    dominios: ['peintegrado.pe.gov.br'], marcas: ['pe integrado', 'peintegrado'] },
  { id: 'ecompras-am', nome: 'e-Compras AM', tipo: 'disputa',
    dominios: ['e-compras.am.gov.br'], marcas: ['e-compras'] },
  { id: 'comprasnet-se', nome: 'Comprasnet SE', tipo: 'disputa',
    dominios: ['comprasnet.se.gov.br', 'aracajucompras.se.gov.br', 'compras.saocristovao.se.gov.br'] },
  { id: 'centraldecompras-pb', nome: 'Central de Compras PB', tipo: 'disputa',
    dominios: ['centraldecompras.pb.gov.br'] },

  // ── Transparência (o link leva ao edital, NÃO à sessão) ───────────────────
  // Casas de software que hospedam o portal de transparência de centenas de
  // municípios. Confirmado pela própria URL, que traz /transparencia/ ou
  // /portal-transparencia/ no caminho.
  { id: 'transparencia-pr', nome: 'Transparência PR (portal estadual)', tipo: 'transparencia',
    dominios: ['transparencia.pr.gov.br'] },
  { id: 'tce-rs', nome: 'TCE-RS (licitações)', tipo: 'transparencia',
    dominios: ['tce.rs.gov.br'] },
  { id: 'geosiap', nome: 'GeoSIAP (transparência municipal)', tipo: 'transparencia',
    dominios: ['geosiap.net.br'], marcas: ['geosiap'] },
  { id: 'agili', nome: 'Ágili (transparência municipal)', tipo: 'transparencia',
    dominios: ['agilicloud.com.br'], marcas: ['agili'] },
  { id: 'governotransparente', nome: 'Governo Transparente', tipo: 'transparencia',
    dominios: ['governotransparente.com.br'], marcas: ['governo transparente'] },
  { id: 'contratosgov', nome: 'ContratosGov', tipo: 'transparencia',
    dominios: ['contratosgov.com.br'], marcas: ['contratosgov'] },
  { id: 'gp-transparencia', nome: 'GP Transparência', tipo: 'transparencia',
    dominios: ['gp.srv.br'] },
  { id: 'sai', nome: 'SAI — Sistema de Acesso à Informação', tipo: 'transparencia',
    dominios: ['sai.io.org.br'], marcas: ['sistema de acesso'] },

  // ── Não classificados ─────────────────────────────────────────────────────
  // Volume relevante e marca evidente no próprio domínio, mas eu NÃO verifiquei
  // se são de disputa ou de transparência. Sem `tipo` de propósito: nomear é
  // seguro, afirmar onde a sessão roda não é.
  { id: 'pncpmap', nome: 'PNCP Map', dominios: ['pncpmap.jelastic.saveincloud.net'] },
  { id: 'empro', nome: 'EMPRO (São José do Rio Preto)', dominios: ['empro.com.br'] },
  { id: 'centi', nome: 'Centi', dominios: ['centi.com.br'] },
  { id: 'slicx', nome: 'SLICX', dominios: ['slicx.com.br'] },
  { id: 'diretriz', nome: 'Diretriz', dominios: ['diretriz.net'] },
  { id: 'cebi', nome: 'CEBI Cloud', dominios: ['cebicloud.com.br'] },

  // ── PNCP, ANTES do curinga ────────────────────────────────────────────────
  // Obrigatoriamente aqui: quando não há link real, /api/opportunities cai na URL
  // canônica `pncp.gov.br/app/editais/...`, e sem esta entrada o curinga `.gov.br`
  // engoliria ~190 mil registros dizendo "Portal do próprio órgão" para uma URL
  // que é do agregador nacional. O PNCP é o mural onde se LÊ o edital — nunca a
  // sessão, por definição.
  { id: 'pncp', nome: 'PNCP', dominios: ['pncp.gov.br'], tipo: 'transparencia' },

  // ── Curinga, SEMPRE por último ────────────────────────────────────────────
  // Sobram ~1.060 hosts de cauda longa, quase todos o site do próprio município
  // (`compras.barueri.sp.gov.br`, `goiandira.go.gov.br`, `catanduva.sp.gov.br`…).
  // Um por um não se paga; dizer "portal do próprio órgão" é verdadeiro e muito
  // mais útil que "Portal não informado". Só chega aqui quem não casou acima.
  { id: 'orgao-proprio', nome: 'Portal do próprio órgão',
    dominios: ['.gov.br', '.leg.br', '.jus.br'] },
]

const POR_ID = new Map(PORTAIS.map((p) => [p.id, p]))

/** Portal "não identificado": o PNCP não informou origem e não achamos marcador. */
export const PORTAL_DESCONHECIDO = { id: 'desconhecido', nome: 'Portal não informado' }

/** Extrai o host de uma URL de forma tolerante (aceita URL suja/sem esquema). */
function host(url: string): string {
  return (url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase()
    .replace(/^www\d?\./, '')
}

/** Identifica o portal por URL (linkSistemaOrigem / link_externo). */
export function portalPorUrl(url: string | null | undefined): string | null {
  const h = host(url ?? '')
  if (!h) return null
  for (const p of PORTAIS) {
    // Casa o domínio exato ou um subdomínio dele.
    if (p.dominios.some((d) => h === d || h.endsWith(`.${d}`) || h.includes(d))) return p.id
  }
  return null
}

/**
 * Identifica o portal por texto livre — serve tanto para o `usuarioNome` do PNCP
 * quanto para o marcador "[LICITANET] - ..." no começo do objeto da compra.
 */
export function portalPorTexto(texto: string | null | undefined): string | null {
  const t = (texto ?? '').toLowerCase()
  if (!t) return null
  // Prioriza o que vem entre colchetes no início — é o marcador mais confiável.
  const entre = t.match(/^\s*\[([^\]]{2,40})\]/)
  const alvo = entre ? entre[1] : t
  for (const p of PORTAIS) {
    for (const m of p.marcas ?? []) {
      if (alvo.includes(m)) return p.id
    }
  }
  return null
}

/**
 * Sinais que a URL dá mas que quase não informam, e por isso PERDEM para o nome
 * do sistema publicador:
 *
 *  - `pncp`: /api/opportunities troca link ausente pela URL canônica
 *    `pncp.gov.br/app/editais/...`. Casar por ela diria "PNCP" para todo registro
 *    sem link — apagando justamente o `usuarioNome` que o harvest coleta.
 *  - `orgao-proprio`: o curinga `.gov.br`. Saber que é "IPM Sistemas" é mais
 *    específico que "Portal do próprio órgão".
 *
 * Não saem do catálogo porque, se NADA mais resolver, ainda são melhores que
 * "Portal não informado" — só descem na fila.
 */
const SINAIS_FRACOS = new Set(['pncp', 'orgao-proprio'])

/**
 * Resolve o portal de uma contratação a partir do que houver. A ordem reflete a
 * confiança de cada sinal: a URL do sistema de origem é a verdade; o nome do
 * sistema vem logo depois; o marcador no objeto é o resgate do histórico. Sinal
 * fraco de URL fica para o fim, senão ele cala os sinais melhores.
 */
export function resolverPortal(row: {
  linkExterno?: string | null
  usuarioNome?: string | null
  objeto?: string | null
  fonte?: string | null
}): string {
  const porUrl = portalPorUrl(row.linkExterno)
  const urlForte = porUrl && !SINAIS_FRACOS.has(porUrl) ? porUrl : null
  return urlForte
    ?? portalPorTexto(row.usuarioNome)
    ?? portalPorTexto(row.objeto)
    // `fonte` só identifica portal quando a coleta veio direto dele (não vale 'pncp',
    // que é o agregador e não diz nada sobre onde a sessão roda).
    ?? (row.fonte && row.fonte !== 'pncp' ? (POR_ID.has(row.fonte) ? row.fonte : null) : null)
    // Último recurso: o sinal fraco da URL. "PNCP" ou "Portal do próprio órgão"
    // ainda diz mais ao fornecedor que "Portal não informado".
    ?? porUrl
    ?? PORTAL_DESCONHECIDO.id
}

/**
 * O link daquele portal leva à SESSÃO da disputa, ou só à leitura do edital?
 *
 * Quem escreve "Disputa no X" na UI tem que passar por aqui. Metade do catálogo
 * é portal de transparência municipal (o PNCP manda essa URL em
 * `linkSistemaOrigem` do mesmo jeito), e afirmar disputa ali é falso: o
 * fornecedor clica esperando a sessão e cai numa página de consulta.
 *
 * `tipo` ausente = não verificado, e não-verificado NÃO conta como disputa.
 */
export function ePortalDeDisputa(id: string | null | undefined): boolean {
  return !!id && POR_ID.get(id)?.tipo === 'disputa'
}

/** Nome amigável de um portal pelo id. */
export function nomePortal(id: string | null | undefined): string {
  if (!id) return PORTAL_DESCONHECIDO.nome
  return POR_ID.get(id)?.nome ?? (id === PORTAL_DESCONHECIDO.id ? PORTAL_DESCONHECIDO.nome : id)
}

/** Catálogo para popular filtros na UI (inclui o "não informado"). */
export function catalogoPortais(): { id: string; nome: string }[] {
  return [...PORTAIS.map((p) => ({ id: p.id, nome: p.nome })), PORTAL_DESCONHECIDO]
}
