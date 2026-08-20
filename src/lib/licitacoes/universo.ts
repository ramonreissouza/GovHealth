// src/lib/licitacoes/universo.ts — o que conta como "licitação de saúde na base" e
// o que conta como "aberta". Em UM lugar, porque estava em cinco.
//
// O problema que isto resolve: a regra de aberta/encerrada já era a mesma em todas
// as telas, mas o UNIVERSO ao redor dela não. Medido em 20/08/2026, o mesmo conceito
// ("abertas") dava três respostas diferentes na mesma plataforma:
//
//   tela             filtro que usava                                  abertas   base
//   landing          valor >= 10000                                    192.467  206.992
//   licitações       valor IS NULL OR valor >= 10000 OR fonte<>pncp     231.650  246.175
//   mapa             (nenhum)                                          319.377  338.232
//
// De onde vinha cada degrau, na base de 338.278 registros:
//   • 39.183 sem valor informado  → a landing cortava (`>= 10000` derruba NULL)
//   • 92.103 abaixo de R$ 10 mil  → o mapa incluía, as listas não
//   •     46 fora do PNCP          → Licitações-e, sem valor na listagem pública
//   •      0 sem objeto_compra     → o filtro de objeto é hoje um no-op; fica porque
//                                    a coleta pode voltar a trazer registro vazio
//
// A regra canônica é a das listas, e ela é uma decisão de PRODUTO, não de dado:
// corta o que SABIDAMENTE é pequeno (< R$ 10 mil não paga a proposta) e mantém o que
// está sem valor informado — porque ali falta um dado da coleta, não relevância. A
// API de busca do PNCP simplesmente não devolve valor para uma parte da base.
//
// Regra de uso: nenhuma tela escreve estes filtros à mão. Se uma tela precisa
// recortar mais (o setup de UF do usuário, um ano, uma categoria), ela ADICIONA
// condição — e o rótulo na tela precisa dizer que está recortado.

/** Sem resultado homologado. O `situacao_id` do PNCP fica velho na base, então a
 *  ausência de resultado é o sinal confiável de que a licitação não encerrou. */
export const ABERTA = (ref = 'contratacoes') =>
  `NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = ${ref}.numero_controle_pncp)`

/** Já tem vencedor definido. */
export const ENCERRADA = (ref = 'contratacoes') => `NOT ${ABERTA(ref)}`

/** O universo de licitações que a plataforma considera vendáveis. */
export const UNIVERSO = (ref = 'contratacoes') =>
  `${ref}.objeto_compra IS NOT NULL AND (${ref}.valor_total_estimado IS NULL` +
  ` OR ${ref}.valor_total_estimado >= 10000 OR ${ref}.fonte <> 'pncp')`

/** Publicadas no ano corrente. "Aberta" sozinha inclui edital de 2025 sem
 *  homologação lançada — chamar aquilo de "esperando proposta" é falso. */
export const ANO_CORRENTE = (ref = 'contratacoes') =>
  `${ref}.data_publicacao >= date_trunc('year', now())`

/** Piso de valor, isolado para quem precisa explicar o corte na tela. */
export const PISO_VALOR = 10_000
