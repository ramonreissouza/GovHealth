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
}

// Catálogo dos portais já observados nos dados do PNCP. Acrescentar portal = uma
// entrada aqui (a UI e os filtros passam a reconhecê-lo automaticamente).
export const PORTAIS: Portal[] = [
  { id: 'comprasgov', nome: 'Compras.gov.br',
    dominios: ['cnetmobile.estaleiro.serpro.gov.br', 'comprasnet.gov.br', 'gov.br/compras', 'compras.gov.br'],
    marcas: ['compras.gov', 'comprasnet', 'compras.gov.br'] },
  { id: 'licitanet', nome: 'Licitanet',
    dominios: ['licitanet.com.br'], marcas: ['licitanet'] },
  { id: 'bnc', nome: 'BNC — Bolsa Nacional de Compras',
    dominios: ['bnccompras.com', 'bnc.org.br'], marcas: ['bnc', 'bolsa nacional'] },
  { id: 'bll', nome: 'BLL — Bolsa de Licitações e Leilões',
    dominios: ['bllcompras.com', 'bllcompras.org.br', 'bll.org.br'], marcas: ['bll'] },
  { id: 'licitacoes-e', nome: 'Licitações-e (Banco do Brasil)',
    dominios: ['licitacoes-e.com.br', 'licitacoes-e2.bb.com.br', 'bb.com.br'], marcas: ['licitacoes-e', 'licitações-e', 'banco do brasil'] },
  { id: 'pcp', nome: 'Portal de Compras Públicas',
    dominios: ['portaldecompraspublicas.com.br'], marcas: ['portal de compras publicas', 'pcp'] },
  { id: 'licitamaisbrasil', nome: 'Licita Mais Brasil',
    dominios: ['licitamaisbrasil.com.br'], marcas: ['licita mais brasil'] },
  { id: 'licitardigital', nome: 'Licitar Digital',
    dominios: ['licitardigital.com.br', 'app2.licitardigital.com.br'], marcas: ['licitar digital'] },
  { id: 'ammlicita', nome: 'AMM Licita',
    dominios: ['ammlicita.org.br', 'app2.ammlicita.org.br'], marcas: ['amm licita'] },
  { id: 'sigep', nome: 'SIGEP',
    dominios: ['sigep.com.br'], marcas: ['sigep'] },
  { id: 'publicenter', nome: 'Publicenter',
    dominios: ['publicenter.com.br'], marcas: ['publicenter'] },
  { id: 'banrisul', nome: 'Pregão Banrisul',
    dominios: ['pregaobanrisul.com.br'], marcas: ['banrisul', 'procergs'] },
  { id: 'm2a', nome: 'M2A Tecnologia',
    dominios: ['compras.m2atecnologia.com.br', 'm2atecnologia.com.br'], marcas: ['m2a'] },
  { id: 'siga', nome: 'SIGA',
    dominios: ['siga.pr.gov.br'], marcas: ['siga'] },
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
 * Resolve o portal de uma contratação a partir do que houver. A ordem reflete a
 * confiança de cada sinal: a URL do sistema de origem é a verdade; o nome do
 * sistema vem logo depois; o marcador no objeto é o resgate do histórico.
 */
export function resolverPortal(row: {
  linkExterno?: string | null
  usuarioNome?: string | null
  objeto?: string | null
  fonte?: string | null
}): string {
  return portalPorUrl(row.linkExterno)
    ?? portalPorTexto(row.usuarioNome)
    ?? portalPorTexto(row.objeto)
    // `fonte` só identifica portal quando a coleta veio direto dele (não vale 'pncp',
    // que é o agregador e não diz nada sobre onde a sessão roda).
    ?? (row.fonte && row.fonte !== 'pncp' ? (POR_ID.has(row.fonte) ? row.fonte : null) : null)
    ?? PORTAL_DESCONHECIDO.id
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
