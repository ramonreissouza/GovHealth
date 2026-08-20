// src/lib/portfolio-servidor.ts
// O PORTFÓLIO DO CLIENTE RESOLVIDO NO SERVIDOR, a partir da conta.
//
// POR QUE ISTO EXISTE: o filtro "Meu Portfólio" precisa das palavras-chave dos
// produtos para casar em SQL, e a primeira versão mandava essas palavras do client
// num parâmetro GET (`?portfolio=["ressonancia magnetica",...]`). Isso publica o
// catálogo comercial do cliente — nomes, marcas e modelos do que ele vende — em
// todo lugar que registra URL: log do proxy, CDN, APM, histórico do navegador. E
// com dezenas de produtos a query string estoura o limite do servidor (HTTP 414).
//
// O portfólio JÁ vive na conta: o Setup da Empresa é sincronizado em
// user_data.chave='empresa' (ver src/lib/synced.ts). Então o client manda só o
// interruptor `portfolio=1` e QUEM resolve o conteúdo é o servidor, pela sessão.
// Nada de portfólio trafega em URL, e um usuário não pode pedir o portfólio de
// outro — a chave de leitura é o id da própria sessão.

import { queryOne } from '@/lib/db'
import { normalizeText } from '@/lib/text'

/** Produto como ele está GRAVADO na conta (JSON de versões variadas do app) —
 *  todo campo é opcional de propósito: blob antigo não tem que ter tudo. */
interface ProdutoLike {
  nome?: string
  marca?: string
  modelo?: string
  palavrasChave?: string[]
  ativo?: boolean
}

/**
 * Frases-alvo (normalizadas) de um produto do portfólio.
 *
 * Espelha `needlesDoProduto` de src/lib/portfolio.ts (a versão do client, que
 * trabalha sobre o tipo completo `ProdutoPortfolio`). A diferença é a tolerância:
 * aqui a entrada é JSON gravado no banco por qualquer versão do app, então campo
 * ausente não pode virar exceção. Mudar o critério de um lado exige mudar o outro
 * — senão o filtro "Meu Portfólio" casa um conjunto diferente do que a tela
 * destaca como "casa com o seu portfólio".
 */
export function needlesDoProduto(p: ProdutoLike): string[] {
  const fontes = [...(p.palavrasChave ?? []), p.nome ?? '', p.marca ?? '', p.modelo ?? '']
  const out = new Set<string>()
  for (const f of fontes) {
    const n = normalizeText(f)
    if (n.length >= 3) out.add(n)
  }
  return [...out]
}

async function lerUserData<T>(userId: string, chave: string, fallback: T): Promise<T> {
  const row = await queryOne<{ valor: T }>(
    `SELECT valor FROM user_data WHERE user_id = $1 AND chave = $2`, [userId, chave],
  )
  return (row?.valor ?? fallback) as T
}

/**
 * Agulhas dos produtos ATIVOS do portfólio da conta. Fonte de verdade: o Setup da
 * Empresa unificado (chave 'empresa'); cai para a chave legada 'portfolio' em conta
 * que ainda não regravou o setup — mesmo fallback de src/lib/radar/selecao.ts.
 *
 * Lista vazia = a conta não tem portfólio ativo sincronizado. Quem chama NÃO deve
 * tratar isso como "sem filtro": o pedido era filtrar pelo portfólio, e devolver a
 * base inteira mostraria oportunidades alheias ao que o cliente vende.
 */
export async function needlesDoPortfolio(userId: string): Promise<string[]> {
  const empresa = await lerUserData<{ produtos?: ProdutoLike[] } | null>(userId, 'empresa', null)
  const produtos = Array.isArray(empresa?.produtos)
    ? empresa!.produtos!
    : await lerUserData<ProdutoLike[]>(userId, 'portfolio', [])
  const vistos = new Set<string>()
  for (const p of produtos) {
    // `ativo` tem que ser explicitamente true, igual a needlesPortfolioAtivo (client).
    // O Radar usa o critério oposto (`ativo !== false`) porque lá o objetivo é não
    // deixar de monitorar por causa de um campo faltando; aqui o filtro tem que casar
    // exatamente o que a tela chama de "Meu Portfólio", senão o botão diz uma coisa e
    // a lista mostra outra.
    if (!p?.ativo) continue
    for (const n of needlesDoProduto(p)) vistos.add(n)
  }
  return [...vistos]
}
