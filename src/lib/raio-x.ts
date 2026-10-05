// src/lib/raio-x.ts — Raio-X da disputa: como um órgão costuma fechar os pregões e quem
// costuma ganhar lá. Lógica pura (sem banco), para teste: a rota (src/app/api/raio-x/
// route.ts) só busca os itens homologados do recorte, e todo o cálculo mora aqui.
//
// Por que órgão e concorrentes, e não "faixa de lance por item": medido em 05/10/2026
// (docs/faixa-lance-medicao.md). Preço por item em R$ cobre 3,7% dos itens abertos — o PNCP
// não traz unidade. O desconto do órgão NA MESMA CATEGORIA prevê melhor que a média
// nacional da categoria. O órgão inteiro (todas as categorias) erra igual à média nacional,
// e a faixa dele acerta 36% em vez de ~50%; por isso não existe fallback para ele.

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
/** Razão homologado/estimado fora disto é unidade trocada entre os dois, não desconto. */
export const RAZAO_MIN = 0.05
export const RAZAO_MAX = 1.5
/** Itens com razão válida abaixo disso não sustentam uma faixa: o bloco não aparece. */
export const MIN_ITENS_DESCONTO = 30
/**
 * ...e eles têm de vir de ao menos 3 pregões: itens do mesmo pregão andam juntos (mesmo
 * estimado, mesma disputa). Backtest 2025→2026 em medicamento + material: com 1-2 pregões
 * a faixa acerta 39,7% (deveria ser ~50%); com 3 ou mais, ~49%.
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

/** Um item homologado do recorte órgão + categoria (pregão, janela de 24 meses). */
export interface ItemHomologado {
  pregao: string          // numero_controle_pncp
  fornecedor: string      // CNPJ/CPF
  nome: string | null
  porte: string | null
  data: string | null     // YYYY-MM-DD
  homologado: number      // valor unitário
  estimado: number | null // valor unitário estimado do edital
  valorTotal: number | null
}

export interface Concorrente {
  cnpj: string
  nome: string
  porte: string | null
  vitorias: number
  /** Fatia dos itens ganhos no recorte, 0-100. */
  participacao: number
  valor: number
  /** Variação mediana sobre o estimado, em %: positivo = abaixo, negativo = acima. null sem amostra. */
  desconto: number | null
  ultima: string | null
}

export interface RaioX {
  /**
   * Variação do vencedor sobre o estimado neste órgão e categoria, em %: positivo =
   * abaixo do estimado, negativo = acima. faixa = [p25, p75] do desconto, do menor para o
   * maior. null sem amostra.
   */
  desconto: { mediana: number; faixa: [number, number]; itens: number } | null
  /** Quem costuma ganhar aqui; null sem amostra. */
  concorrentes: Concorrente[] | null
  base: { itens: number; licitacoes: number; vencedores: number }
  janelaDias: number
}

/** Percentil com interpolação linear — o mesmo que o percentile_cont do Postgres. */
export function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return NaN
  const pos = (ordenados.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (pos - lo)
}

const desconto = (razao: number) => Math.round((1 - razao) * 100)

function razaoBruta(i: ItemHomologado): number | null {
  if (!(i.estimado != null && i.estimado > 0) || !(i.homologado > 0)) return null
  const r = i.homologado / i.estimado
  return r > RAZAO_MIN && r <= RAZAO_MAX ? r : null
}

/**
 * Razões que entram na conta, por item (null = fora).
 *
 * Homologado = estimado (razão 1) ENTRA: é desconto 0%, um desfecho real que o cliente
 * precisa prever. 91% desses itens estão em pregões em que outros itens tiveram desconto.
 * Sai só o pregão em que TODOS os itens saíram pelo estimado: aí o estimado foi preenchido
 * com o homologado, não houve referência para medir. Backtest (medicamento + material,
 * 2025→2026): excluir toda razão 1 acertava a faixa 44,5% e errava 15,7 pontos; esta regra
 * acerta 49,7% e erra 15,2.
 */
export function razoesValidas(itens: ItemHomologado[]): (number | null)[] {
  const brutas = itens.map(razaoBruta)
  const todoNoEstimado = new Map<string, boolean>()
  itens.forEach((it, k) => {
    const r = brutas[k]
    if (r == null) return
    todoNoEstimado.set(it.pregao, (todoNoEstimado.get(it.pregao) ?? true) && r === 1)
  })
  return brutas.map((r, k) => (r != null && !todoNoEstimado.get(itens[k].pregao) ? r : null))
}

/**
 * Monta o Raio-X a partir dos itens do recorte. Cada bloco tem a sua régua: o desconto é
 * uma previsão (pede 30 itens de 3 pregões), os concorrentes são um fato (pede 10 itens
 * e 3 vencedores). Sem amostra, o bloco fica null em vez de mostrar um número fraco, que
 * seria lido como recomendação.
 */
export function calcularRaioX(itens: ItemHomologado[]): RaioX {
  const razoes = razoesValidas(itens)
  const validas = razoes.filter((r): r is number => r != null).sort((a, b) => a - b)
  const pregoesValidos = new Set(itens.filter((_, k) => razoes[k] != null).map((i) => i.pregao))

  const descontoBloco =
    validas.length >= MIN_ITENS_DESCONTO && pregoesValidos.size >= MIN_PREGOES_DESCONTO
      ? {
          mediana: desconto(percentil(validas, 0.5)),
          // p75 da razão = o MENOR desconto da faixa
          faixa: [desconto(percentil(validas, 0.75)), desconto(percentil(validas, 0.25))] as [number, number],
          itens: validas.length,
        }
      : null

  const porFornecedor = new Map<string, { itens: ItemHomologado[]; razoes: number[]; pregoesRazao: Set<string> }>()
  itens.forEach((it, k) => {
    const f = porFornecedor.get(it.fornecedor) ?? { itens: [], razoes: [], pregoesRazao: new Set<string>() }
    f.itens.push(it)
    const r = razoes[k]
    if (r != null) { f.razoes.push(r); f.pregoesRazao.add(it.pregao) }
    porFornecedor.set(it.fornecedor, f)
  })

  const total = itens.length
  const concorrentes =
    total >= MIN_ITENS_CONCORRENTES && porFornecedor.size >= MIN_VENCEDORES
      ? [...porFornecedor.entries()]
          .map(([cnpj, f]) => {
            const valor = f.itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0)
            const datas = f.itens.map((i) => i.data).filter((d): d is string => !!d).sort()
            const comNome = f.itens.find((i) => i.nome?.trim())
            const comPorte = f.itens.find((i) => i.porte)
            const ord = [...f.razoes].sort((a, b) => a - b)
            return {
              cnpj,
              nome: comNome?.nome?.trim() || cnpj,
              porte: comPorte?.porte ?? null,
              vitorias: f.itens.length,
              participacao: Math.round((f.itens.length / total) * 100),
              valor,
              desconto:
                ord.length >= MIN_ITENS_CONCORRENTE && f.pregoesRazao.size >= MIN_PREGOES_CONCORRENTE
                  ? desconto(percentil(ord, 0.5))
                  : null,
              ultima: datas.length ? datas[datas.length - 1] : null,
            }
          })
          .sort((a, b) => b.vitorias - a.vitorias || b.valor - a.valor)
          .slice(0, TOP_CONCORRENTES)
      : null

  return {
    desconto: descontoBloco,
    concorrentes,
    base: { itens: total, licitacoes: new Set(itens.map((i) => i.pregao)).size, vencedores: porFornecedor.size },
    janelaDias: JANELA_DIAS,
  }
}

// ── Texto: o desconto pode ser negativo (homologado acima do estimado) ──────────

/** "34% abaixo do estimado", "no próprio estimado", "5% acima do estimado". */
export function textoVariacao(d: number): string {
  if (d > 0) return `${d}% abaixo do estimado`
  if (d < 0) return `${-d}% acima do estimado`
  return 'no próprio estimado'
}

/** A faixa [menor desconto, maior desconto] em português, sem número negativo. */
export function textoFaixa([a, b]: [number, number]): string {
  if (a === b) return textoVariacao(a)
  if (a > 0) return `entre ${a}% e ${b}% abaixo do estimado`
  if (b < 0) return `entre ${-b}% e ${-a}% acima do estimado`
  if (a === 0) return `entre o próprio estimado e ${b}% abaixo dele`
  if (b === 0) return `entre ${-a}% acima do estimado e o próprio estimado`
  return `entre ${-a}% acima e ${b}% abaixo do estimado`
}
