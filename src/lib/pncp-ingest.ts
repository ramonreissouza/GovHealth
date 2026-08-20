// src/lib/pncp-ingest.ts — GRAVAÇÃO de contratações do PNCP no banco, do lado do app.
// É o que faltava para o cron diário da Vercel atualizar a base de verdade: buscar já
// existia (lib/pncp.ts), mas nada persistia — o cron só contava e descartava.
//
// UPSERT idempotente espelhando `upsertContratacao` de scripts/etl-pncp.mjs: mesma
// tabela, mesma chave (numero_controle_pncp), MESMAS colunas. Auditado contra o schema
// em 20/08/2026 — a versão de julho deste arquivo já nascia velha em três pontos:
//
//   • data_abertura_proposta / data_encerramento_proposta — colunas criadas depois
//     (datas:migrate). Sem elas a licitação mais NOVA seria a única sem prazo na tela
//     de Portais Estaduais, e `estaAberta()` cairia no fallback de situacao_id.
//   • link_externo / usuario_nome — vêm na MESMA resposta de lista, de graça (o link em
//     ~44% dos registros, o nome do sistema em ~100%). Gravá-los aqui é o que impede a
//     contratação nova de entrar na fila do harvest-portais.mjs. COALESCE no conflito:
//     uma releitura sem link nunca apaga o link que já temos.
//   • categoria_saude — agora via `categoria()` de lib/saude-filter, a taxonomia de 14.
//     A cópia que morava aqui era a de 7, em que 'outros' engolia 65% da base.
//
// NÃO grava tipo_fornecimento (coluna GENERATED STORED, o Postgres calcula) e NÃO bumpa
// coletado_em no conflito — igual ao ETL. Isso preserva o significado de coletado_em
// ("quando entrou algo novo"), que é o sinal usado para medir se o cron está de fato
// trazendo licitação nova. Foi essa medição que revelou, em 20/08/2026, que a correção
// de julho havia sido desfeita por um deploy.
//
// Cuida só do CABEÇALHO da contratação (a oportunidade em si) — o essencial para o
// usuário não perder demanda nova. O enriquecimento caro (itens + resultados
// homologados, que decidem aberta→encerrada) segue no refresh periódico, que roda sem
// o limite de tempo de uma função serverless.

import { query } from '@/lib/db'
import { categoria } from '@/lib/saude-filter'
import type { PNCPContratacao } from '@/lib/types'

export interface IngestResumo {
  recebidas: number    // contratações candidatas (após dedup) enviadas ao banco
  gravadas: number     // upserts concluídos com sucesso (novas + atualizadas)
  novas: number        // linhas que NÃO existiam — a métrica que importa
  atualizadas: number  // já existiam; valor/prazo/portal podem ter mudado
  falhas: number
}

/** Grava um lote de contratações. Idempotente: pode rodar quantas vezes quiser. */
export async function upsertContratacoes(rows: PNCPContratacao[]): Promise<IngestResumo> {
  // Dedup por número de controle (a mesma compra vem de /proposta e de /publicacao).
  const unicas = new Map<string, PNCPContratacao>()
  for (const c of rows) {
    if (c?.numeroControlePNCP) unicas.set(c.numeroControlePNCP, c)
  }
  const lista = [...unicas.values()]

  let novas = 0
  let atualizadas = 0
  let falhas = 0
  // O Pool de lib/db tem max=5 e atravessa o PgBouncer: 4 em voo deixa folga para as
  // requisições que os usuários estão fazendo ao mesmo tempo.
  const CONCORRENCIA = 4
  for (let i = 0; i < lista.length; i += CONCORRENCIA) {
    const bloco = lista.slice(i, i + CONCORRENCIA)
    const res = await Promise.allSettled(bloco.map((c) => upsertUma(c)))
    for (const r of res) {
      if (r.status !== 'fulfilled') falhas++
      else if (r.value) novas++
      else atualizadas++
    }
  }
  return { recebidas: lista.length, gravadas: novas + atualizadas, novas, atualizadas, falhas }
}

/**
 * Registra a rodada em etl_checkpoint — a MESMA tabela que o selo de "coletado há Xh"
 * já consulta (lib/coleta-meta.ts faz GREATEST com MAX(coletado_em)), então o selo passa
 * a refletir o cron diário e não só o ETL local de três em três dias.
 *
 * A linha `cron:sync-pncp` é também o teste de vida deste cron, legível em uma consulta:
 * `atualizado_em` = quando rodou por último, `ultima_pagina` = quantas licitações NOVAS
 * trouxe. Marcamos mesmo com zero novas — é um resultado, e é justamente o zero
 * persistente que denuncia um sync quebrado. A regressão de julho passou um mês
 * invisível por não existir nenhum sinal desses.
 */
export async function marcarColeta(novas: number): Promise<void> {
  await query(
    `INSERT INTO etl_checkpoint (chave, ultima_pagina, atualizado_em)
     VALUES ('cron:sync-pncp', $1, now())
     ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`,
    [novas],
  )
}

/**
 * Grava uma contratação. Devolve TRUE quando a linha é nova.
 *
 * `xmax = 0` é o jeito do Postgres de responder "foi INSERT, não UPDATE" (numa linha
 * recém-inserida não há transação que a tenha substituído). Sem essa distinção, um cron
 * que só reencontra as mesmas licitações antigas reporta "gravadas: 200" e parece
 * saudável — que é exatamente como a regressão de julho passou um mês invisível.
 */
async function upsertUma(c: PNCPContratacao): Promise<boolean> {
  const rows = await query<{ inserida: boolean }>(
    `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
       modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
       data_publicacao, data_abertura_proposta, data_encerramento_proposta, situacao_id, categoria_saude,
       link_externo, usuario_nome, portal_backfill_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       -- Portal já resolvido na própria resposta de lista? Então a linha nasce fora da
       -- fila do harvest-portais.mjs (que é "portal_backfill_em IS NULL"). Sem isto, o
       -- cron alimentaria diariamente a fila que o coletor leva dias para drenar.
       CASE WHEN $16::text IS NOT NULL OR $17::text IS NOT NULL THEN now() END)
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       valor_total_estimado       = EXCLUDED.valor_total_estimado,
       data_abertura_proposta     = EXCLUDED.data_abertura_proposta,
       data_encerramento_proposta = EXCLUDED.data_encerramento_proposta,
       situacao_id                = EXCLUDED.situacao_id,
       categoria_saude            = EXCLUDED.categoria_saude,
       link_externo               = COALESCE(EXCLUDED.link_externo, contratacoes.link_externo),
       usuario_nome               = COALESCE(EXCLUDED.usuario_nome, contratacoes.usuario_nome),
       portal_backfill_em         = COALESCE(contratacoes.portal_backfill_em, EXCLUDED.portal_backfill_em)
     RETURNING (xmax = 0) AS inserida`,
    [
      c.numeroControlePNCP,
      c.orgaoEntidade?.cnpj ?? '',
      c.orgaoEntidade?.razaoSocial ?? null,
      c.unidadeOrgao?.municipioNome ?? null,
      c.unidadeOrgao?.ufSigla ?? null,
      c.modalidadeNome ?? null,
      c.objetoCompra ?? null,
      c.anoCompra ?? null,
      c.sequencialCompra ?? null,
      c.valorTotalEstimado ?? null,
      (c.dataPublicacaoPncp ?? '').slice(0, 10) || null,
      (c.dataAberturaProposta ?? '').slice(0, 10) || null,
      (c.dataEncerramentoProposta ?? '').slice(0, 10) || null,
      c.situacaoCompraId ?? null,
      categoria(c.objetoCompra),
      (c.linkSistemaOrigem ?? '').trim() || null,
      (c.usuarioNome ?? '').trim() || null,
    ],
  )
  return rows[0]?.inserida === true
}
