// src/lib/raio-x.ts — Raio-X da disputa: como um órgão costuma fechar os pregões e quem
// costuma ganhar lá. Lógica pura (sem banco), para teste; a consulta mora em
// src/app/api/raio-x/route.ts.
//
// Por que órgão e concorrentes, e não "faixa de lance por item": medido em 05/10/2026
// (docs/faixa-lance-medicao.md). Preço por item em R$ cobre 3,7% dos itens abertos — o PNCP
// não traz unidade. O desconto do órgão NA MESMA CATEGORIA prevê melhor que a média
// nacional da categoria (erro mediano 16 pontos contra 20). O órgão inteiro (todas as
// categorias) erra igual à média nacional, e a faixa dele acerta 36% em vez de ~50%; por
// isso não existe fallback para ele.

/**
 * Só onde a cobertura medida passa de 60% das licitações abertas em pregão (05/10/2026):
 * medicamento 65-68%, material hospitalar 62-69%. Nas demais (equipamento 17-28%, imagem
 * 5%, ambulância 2%) o Raio-X quase nunca apareceria. Função que some na maioria das
 * licitações cria expectativa e piora a percepção, então nelas ele não existe.
 */
export const CATEGORIAS_RAIO_X: readonly string[] = ['medicamento', 'material_hospitalar']

export function raioXDisponivel(categoria: string | null | undefined): boolean {
  return !!categoria && CATEGORIAS_RAIO_X.includes(categoria)
}

/** Janela do histórico. */
export const JANELA_DIAS = 730
/** Itens com desconto válido abaixo disso não sustentam uma faixa: o bloco não aparece. */
export const MIN_ITENS_DESCONTO = 30
/**
 * ...e eles têm de vir de ao menos 3 pregões: itens do mesmo pregão andam juntos (mesmo
 * estimado, mesma disputa). Backtest 2025→2026 em medicamento + material: com 1-2 pregões
 * a faixa acerta 39,7% (deveria ser ~50%); com 3+, 48,8% e erro mediano de 14,8 pontos
 * contra 20,2 da média nacional da categoria.
 */
export const MIN_PREGOES_DESCONTO = 3
/** "Quem costuma ganhar aqui" pede ao menos isto de itens ganhos e de vencedores distintos. */
export const MIN_ITENS_CONCORRENTES = 10
export const MIN_VENCEDORES = 3
/** Desconto próprio do concorrente só com este número de itens dele no recorte... */
export const MIN_ITENS_CONCORRENTE = 5
/** ...vindos de pregões diferentes (mesmo motivo do MIN_PREGOES_DESCONTO). */
export const MIN_PREGOES_CONCORRENTE = 2
export const TOP_CONCORRENTES = 5

/** Estatística da razão homologado/estimado no recorte órgão + categoria, como vem do banco. */
export interface EstatRazao {
  n: number              // itens com desconto válido (ver filtro na rota)
  p25: number | null
  p50: number | null
  p75: number | null
  itens: number          // itens ganhos no recorte (com ou sem desconto válido)
  licitacoes: number
  licitacoesDesconto: number // pregões distintos dos itens com desconto válido
  vencedores: number
}

export interface ConcorrenteBruto {
  cnpj: string
  nome: string | null
  porte: string | null
  vitorias: number
  valor: number | null
  n_desconto: number
  pregoes_desconto: number
  ratio_mediana: number | null
  ultima: string | null  // YYYY-MM-DD
}

export interface RaioXBruto {
  estat: EstatRazao
  concorrentes: ConcorrenteBruto[]
}

export interface Concorrente {
  cnpj: string
  nome: string
  porte: string | null
  vitorias: number
  /** Fatia dos itens ganhos no recorte, 0-100. */
  participacao: number
  valor: number
  /** Desconto mediano sobre o estimado, 0-100; null quando ele tem poucos itens ali. */
  desconto: number | null
  ultima: string | null
}

export interface RaioX {
  /** Desconto do vencedor sobre o estimado neste órgão e categoria; null sem amostra. */
  desconto: { mediana: number; faixa: [number, number]; itens: number } | null
  /** Quem costuma ganhar aqui; null sem amostra. */
  concorrentes: Concorrente[] | null
  base: { itens: number; licitacoes: number; vencedores: number }
  janelaDias: number
}

const pct = (razao: number) => Math.round((1 - razao) * 100)

/**
 * Converte razão em desconto e decide o que mostrar. Cada bloco tem a sua régua: o
 * desconto é uma previsão (pede 30 itens de 3 pregões), os concorrentes são um fato
 * (pede 10 itens e 3 vencedores). Sem amostra, o bloco fica null em vez de mostrar um número fraco,
 * que seria lido como recomendação.
 */
export function montarRaioX(bruto: RaioXBruto): RaioX {
  const e = bruto.estat
  const desconto =
    e.n >= MIN_ITENS_DESCONTO && e.licitacoesDesconto >= MIN_PREGOES_DESCONTO && e.p25 != null && e.p50 != null && e.p75 != null
      // p75 da razão = o MENOR desconto da faixa
      ? { mediana: pct(e.p50), faixa: [pct(e.p75), pct(e.p25)] as [number, number], itens: e.n }
      : null

  const concorrentes =
    e.itens >= MIN_ITENS_CONCORRENTES && e.vencedores >= MIN_VENCEDORES
      ? bruto.concorrentes.slice(0, TOP_CONCORRENTES).map((c) => ({
          cnpj: c.cnpj,
          nome: c.nome?.trim() || c.cnpj,
          porte: c.porte,
          vitorias: Number(c.vitorias),
          participacao: e.itens > 0 ? Math.round((Number(c.vitorias) / e.itens) * 100) : 0,
          valor: Number(c.valor ?? 0),
          desconto:
            Number(c.n_desconto) >= MIN_ITENS_CONCORRENTE &&
            Number(c.pregoes_desconto) >= MIN_PREGOES_CONCORRENTE &&
            c.ratio_mediana != null
              ? pct(Number(c.ratio_mediana))
              : null,
          ultima: c.ultima,
        }))
      : null

  return {
    desconto,
    concorrentes,
    base: { itens: e.itens, licitacoes: e.licitacoes, vencedores: e.vencedores },
    janelaDias: JANELA_DIAS,
  }
}

/** Converte o JSON do banco (números podem vir como string) para EstatRazao. */
export function estatDoBanco(j: Record<string, unknown> | null | undefined): EstatRazao {
  const num = (v: unknown) => (v == null ? null : Number(v))
  return {
    n: Number(j?.n ?? 0),
    p25: num(j?.p25),
    p50: num(j?.p50),
    p75: num(j?.p75),
    itens: Number(j?.itens ?? 0),
    licitacoes: Number(j?.licitacoes ?? 0),
    licitacoesDesconto: Number(j?.licitacoes_desconto ?? 0),
    vencedores: Number(j?.vencedores ?? 0),
  }
}
