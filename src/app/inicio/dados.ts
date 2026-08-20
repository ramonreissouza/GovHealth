// src/app/inicio/dados.ts — números REAIS da landing, em um lugar só.
//
// Extraído de page.tsx quando surgiu a segunda landing (/inicio/proposta): duas
// cópias da mesma consulta divergem, e a divergência apareceria justamente entre
// duas versões da MESMA página, que é o pior lugar possível para isso acontecer.

import { query } from '@/lib/db'
import { resolverPortal, ePortalDeDisputa, nomePortal } from '@/lib/portais'
import { ABERTA, UNIVERSO, ANO_CORRENTE } from '@/lib/licitacoes/universo'

// O universo vem de src/lib/licitacoes/universo.ts — o MESMO do mapa, das listas e
// dos alertas. A landing tinha o seu próprio (`valor >= 10000`, que derruba valor
// nulo) e por isso anunciava 192.467 abertas enquanto a tela de Licitações mostrava
// 231.650 e o mapa 319.377: três respostas para a mesma pergunta no mesmo produto.
//
// O teto de valor impossível NÃO é filtrado aqui de propósito: já é NULL no banco
// (ver scripts/limpar-ruido.mjs) e SUM ignora NULL. Antes daquele conserto esta
// página publicava R$ 2.680 bi — 6 erros de digitação do PNCP somavam 10x a base.
export interface Stats {
  valor: number; total: number; munis: number; ufs: number; ult: string
  abertas: number; abertasAno: number
  portais: number; fornecedores: number; capag: number; capagFraca: number
}

export async function getStats(): Promise<Stats> {
  // Fallback medido no banco em 20/08/2026, JÁ no universo canônico — se a query
  // falhar no build, a página publica número verdadeiro, só velho.
  const fallback: Stats = {
    valor: 947_400_000_000, total: 246_175, munis: 4_800, ufs: 27, ult: '18/08/2026',
    abertas: 231_650, abertasAno: 88_614,
    portais: 101, fornecedores: 14_668, capag: 4_774, capagFraca: 2_209,
  }
  try {
    const [r] = await query<Stats>(
      `SELECT sum(c.valor_total_estimado)::float8 AS valor, count(*)::int AS total,
              count(distinct c.municipio)::int AS munis, count(distinct c.uf)::int AS ufs,
              to_char(max(c.data_publicacao),'DD/MM/YYYY') AS ult,
              -- "Abertas" = sem resultado homologado. O situacao_id do PNCP fica velho,
              -- então a ausência de resultado é a fonte de verdade (ver memória do
              -- status aberto/encerrado).
              count(*) FILTER (WHERE ${ABERTA('c')})::int AS abertas,
              -- ABERTAS DO ANO: mesma regra, recortada no ano corrente. "Sem resultado
              -- homologado" inclui edital de 2025 que nunca teve homologação lançada —
              -- chamar aquilo de "esperando proposta" é falso, e o print do mapa na
              -- mesma página desmentia o título. Este é o número que a landing anuncia.
              count(*) FILTER (WHERE ${ANO_CORRENTE('c')} AND ${ABERTA('c')})::int AS "abertasAno",
              (SELECT count(distinct usuario_nome)::int FROM contratacoes WHERE usuario_nome IS NOT NULL) AS portais,
              (SELECT count(distinct ni_fornecedor)::int FROM resultados WHERE ni_fornecedor IS NOT NULL) AS fornecedores,
              (SELECT count(*)::int FROM capag) AS capag,
              -- Nota C ou D = capacidade de pagamento fraca. É o número que
              -- justifica olhar CAPAG antes de dar lance, então vem do banco.
              (SELECT count(*)::int FROM capag WHERE nota IN ('C','D')) AS "capagFraca"
         FROM contratacoes c
        WHERE ${UNIVERSO('c')}`,
    )
    return r?.total ? r : fallback
  } catch {
    return fallback
  }
}

/**
 * Portais de DISPUTA com licitação de saúde na base, do maior para o menor.
 *
 * Só entra `tipo: 'disputa'`. Metade do catálogo é portal de transparência (o
 * PNCP manda essa URL em `linkSistemaOrigem` igual), e ali o link leva à leitura
 * do edital, não à sessão — nomear isso como portal de disputa numa página de
 * venda é o tipo de exagero que o cliente derruba na primeira demo.
 *
 * Agrupa por (host, sistema) e resolve em TS com o MESMO `resolverPortal` da
 * tela, em vez de reescrever o catálogo em SQL: duas cópias da regra divergem, e
 * a divergência apareceria justamente na landing. São ~1.100 hosts × ~100
 * sistemas publicadores, então a consulta é barata.
 */
export async function getPortaisDisputa(): Promise<{ nome: string; n: number }[]> {
  try {
    const rows = await query<{ host: string; sistema: string; n: number }>(
      `SELECT lower(split_part(split_part(regexp_replace(coalesce(link_externo,''), '^https?://', ''), '/', 1), ':', 1)) AS host,
              coalesce(usuario_nome, '') AS sistema, count(*)::int AS n
         FROM contratacoes
        WHERE link_externo IS NOT NULL OR usuario_nome IS NOT NULL
        GROUP BY 1, 2`)

    const soma = new Map<string, number>()
    for (const r of rows) {
      const id = resolverPortal({ linkExterno: r.host || null, usuarioNome: r.sistema || null })
      if (!ePortalDeDisputa(id)) continue
      soma.set(id, (soma.get(id) ?? 0) + Number(r.n))
    }
    return [...soma.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ nome: nomePortal(id), n }))
  } catch {
    return []
  }
}

export const num = (n: number) => n.toLocaleString('pt-BR')
export const bilhoes = (v: number) =>
  `R$ ${(v / 1e9).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bi`
