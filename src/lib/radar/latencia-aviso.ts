// src/lib/radar/latencia-aviso.ts — quanto tempo o Aviso leva, etapa por etapa, para a
// aba Aviso do admin (/api/admin/aviso). Só leitura.
//
// Meta: atraso p95 de até 60 s em sessão ativa (docs/radar-diagnostico-2026-09-23.md,
// "Meta inicial proposta"). As etapas, cada uma com p50/p95:
//   captura      portal escreveu (horario_origem) → nós lemos (capturado_em)
//   envio        nós lemos → o aviso imediato saiu (enviado_em; o worker roda a cada 5 min)
//   ponta a ponta portal escreveu → o aviso saiu: é o que o cliente sente
//   "Vi"         o aviso saiu → alguém confirmou (confirmado_em)
//
// SÓ MENSAGEM NOVA. A primeira leitura de um pregão traz o chat inteiro de antes: no BLL,
// a mediana de capturado − horario_origem dava 40 dias (out/2026). Conta só a mensagem
// escrita DEPOIS da primeira captura daquele processo, que é a que o monitoramento
// poderia ter avisado na hora.
//
// HORA DO PORTAL NO FUTURO (horario_origem > capturado_em) não entra na conta e é contada
// à parte: é relógio ou fuso errado na leitura, não latência. Foi assim que apareceu o
// fuso do PCP (scripts/radar/connector-base.mjs, FUSO_NAVEGADOR).

import { query } from '@/lib/db'
import { nomeConector } from '@/lib/radar/conectores'

/** Meta de p95 de ponta a ponta, em segundos. */
export const META_P95_S = 60

export interface Faixa {
  n: number
  /** Segundos. null sem amostra. */
  p50: number | null
  p95: number | null
  /** Fração (0–1) dentro da meta de 60 s. */
  naMeta: number | null
}

export interface PainelAviso {
  /** Quando foi medido (ISO): a base do "há quanto tempo" da tela. */
  geradoEm: string
  dias: number
  metaS: number
  captura: Faixa & { futuro: number }
  envio: Faixa & { falhas: number }
  pontaAPonta: Faixa
  vi: Faixa & { enviados: number }
  repasses: number
  porPortal: { conector: string; nome: string; captura: Faixa; futuro: number; pontaAPonta: Faixa; ultimaCaptura: string | null }[]
  serie: { dia: string; novas: number; capturaP95: number | null; pontaP95: number | null }[]
  /** Status das notificações de e-mail criadas no período (nova_mensagem). */
  porStatus: { status: string; n: number }[]
  /** A fila de agora, sem olhar o período: o que o worker ainda não tocou. */
  fila: { pendentes: number; maisAntigoMin: number | null }
  /** Última mensagem lida de qualquer portal, em minutos, sem olhar o período. Sem
   *  captura, todas as outras etapas param: é o primeiro sinal de coletor parado. */
  semCapturaHaMin: number | null
}

interface FaixaRow { n: number; p50: number | null; p95: number | null; na_meta: number | null }

const faixa = (r: FaixaRow | undefined): Faixa => ({
  n: r?.n ?? 0,
  p50: r?.p50 == null ? null : Math.round(r.p50),
  p95: r?.p95 == null ? null : Math.round(r.p95),
  naMeta: r?.na_meta ?? null,
})

/** p50, p95 e fração na meta de uma expressão em segundos. */
const agregados = (seg: string) => `count(*)::int AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ${seg})::float8 AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ${seg})::float8 AS p95,
  (avg(CASE WHEN ${seg} <= ${META_P95_S} THEN 1 ELSE 0 END))::float8 AS na_meta`

const CAP_S = `EXTRACT(EPOCH FROM m.capturado_em - m.horario_origem)`
/** Sobre a CTE `avisos` (n): portal escreveu → aviso saiu. */
const PONTA_S = `EXTRACT(EPOCH FROM n.enviado_em - n.m_origem)`
/** Aviso que conta no ponta a ponta: mensagem nova, com hora do portal plausível. */
const PONTA_VALIDA = `n.nova AND n.m_origem <= n.m_capturado`

/**
 * Mensagens novas do período (`novas`) e avisos imediatos de e-mail (`avisos`). O repasse
 * (id esc:…) não é aviso novo: entra só na contagem de repasses.
 */
const CTE = `
  ini AS (
    SELECT processo_id, min(capturado_em) AS ini FROM radar_mensagens
     WHERE processo_id IN (SELECT DISTINCT processo_id FROM radar_mensagens WHERE capturado_em > now() - make_interval(days => $1))
     GROUP BY 1),
  novas AS (
    SELECT m.* FROM radar_mensagens m JOIN ini USING (processo_id)
     WHERE m.capturado_em > now() - make_interval(days => $1)
       AND m.horario_origem IS NOT NULL AND m.horario_origem > ini.ini),
  avisos AS (
    SELECT n.*, m.conector_id, m.capturado_em AS m_capturado, m.horario_origem AS m_origem,
           m.horario_origem > (SELECT min(x.capturado_em) FROM radar_mensagens x WHERE x.processo_id = m.processo_id) AS nova
      FROM radar_notificacoes n JOIN radar_mensagens m ON m.id = n.mensagem_id
     WHERE n.criado_em > now() - make_interval(days => $1)
       AND n.canal = 'email' AND n.evento = 'nova_mensagem' AND n.id NOT LIKE 'esc:%'
       AND n.enviado_em IS NOT NULL)`

export async function painelAviso(diasPedidos: number): Promise<PainelAviso> {
  const dias = Math.min(Math.max(Math.floor(diasPedidos) || 7, 1), 90)
  const a = [dias]
  const [cap, env, ponta, vi, rep, capPortal, pontaPortal, serie, status, fila, ultimas] = await Promise.all([
    query<FaixaRow & { futuro: number }>(
      `WITH ${CTE}
       SELECT ${agregados(CAP_S)}, (SELECT count(*)::int FROM novas m WHERE m.horario_origem > m.capturado_em) AS futuro
         FROM novas m WHERE m.horario_origem <= m.capturado_em`, a),
    query<FaixaRow & { falhas: number }>(
      `WITH ${CTE}
       SELECT ${agregados('EXTRACT(EPOCH FROM n.enviado_em - n.m_capturado)')},
              count(*) FILTER (WHERE n.status = 'falha')::int AS falhas
         FROM avisos n`, a),
    query<FaixaRow>(
      `WITH ${CTE}
       SELECT ${agregados(PONTA_S)} FROM avisos n WHERE ${PONTA_VALIDA}`, a),
    query<FaixaRow & { enviados: number }>(
      `WITH ${CTE}
       SELECT ${agregados('EXTRACT(EPOCH FROM n.confirmado_em - n.enviado_em)')},
              (SELECT count(*)::int FROM avisos WHERE status = 'enviado' OR confirmado_em IS NOT NULL) AS enviados
         FROM avisos n WHERE n.confirmado_em IS NOT NULL AND n.confirmado_em >= n.enviado_em`, a),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM radar_notificacoes
        WHERE id LIKE 'esc:%' AND status = 'enviado' AND criado_em > now() - make_interval(days => $1)`, a),
    query<FaixaRow & { conector: string; futuro: number }>(
      `WITH ${CTE}
       SELECT m.conector_id AS conector,
              count(*) FILTER (WHERE m.horario_origem > m.capturado_em)::int AS futuro,
              count(*) FILTER (WHERE m.horario_origem <= m.capturado_em)::int AS n,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY ${CAP_S}) FILTER (WHERE m.horario_origem <= m.capturado_em))::float8 AS p50,
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY ${CAP_S}) FILTER (WHERE m.horario_origem <= m.capturado_em))::float8 AS p95,
              (avg(CASE WHEN ${CAP_S} <= ${META_P95_S} THEN 1 ELSE 0 END) FILTER (WHERE m.horario_origem <= m.capturado_em))::float8 AS na_meta
         FROM novas m GROUP BY 1 ORDER BY count(*) DESC`, a),
    query<FaixaRow & { conector: string }>(
      `WITH ${CTE}
       SELECT n.conector_id AS conector, ${agregados(PONTA_S)}
         FROM avisos n WHERE ${PONTA_VALIDA} GROUP BY 1`, a),
    query<{ dia: string; novas: number; captura_p95: number | null; ponta_p95: number | null }>(
      `WITH ${CTE},
       c AS (SELECT to_char(m.capturado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
                    count(*)::int AS novas,
                    (percentile_cont(0.95) WITHIN GROUP (ORDER BY ${CAP_S}) FILTER (WHERE m.horario_origem <= m.capturado_em))::float8 AS captura_p95
               FROM novas m GROUP BY 1),
       p AS (SELECT to_char(n.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY ${PONTA_S})::float8 AS ponta_p95
               FROM avisos n WHERE ${PONTA_VALIDA} GROUP BY 1)
       SELECT coalesce(c.dia, p.dia) AS dia, coalesce(c.novas, 0) AS novas, c.captura_p95, p.ponta_p95
         FROM c FULL JOIN p USING (dia) ORDER BY 1`, a),
    query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM radar_notificacoes
        WHERE canal = 'email' AND evento = 'nova_mensagem' AND id NOT LIKE 'esc:%'
          AND criado_em > now() - make_interval(days => $1)
        GROUP BY 1 ORDER BY 2 DESC`, a),
    query<{ pendentes: number; mais_antigo_min: number | null }>(
      `SELECT count(*)::int AS pendentes, round(EXTRACT(EPOCH FROM now() - min(criado_em)) / 60)::int AS mais_antigo_min
         FROM radar_notificacoes WHERE canal = 'email' AND status = 'pendente'`),
    query<{ conector: string; ultima: string }>(
      `SELECT conector_id AS conector, max(capturado_em) AS ultima FROM radar_mensagens GROUP BY 1`),
  ])

  const pontaPorConector = new Map(pontaPortal.map((r) => [r.conector, faixa(r)]))
  const ultimaPorConector = new Map(ultimas.map((r) => [r.conector, new Date(r.ultima).toISOString()]))
  const ultima = Math.max(...ultimas.map((r) => new Date(r.ultima).getTime()))
  // Todo portal que já leu alguma coisa, mesmo sem mensagem nova no período: o portal
  // parado é justamente o que some de uma lista feita só com o que chegou.
  const capPorConector = new Map(capPortal.map((r) => [r.conector, r]))
  const conectores = [...new Set([...capPortal.map((r) => r.conector), ...ultimas.map((r) => r.conector)])]
  return {
    geradoEm: new Date().toISOString(),
    dias,
    metaS: META_P95_S,
    captura: { ...faixa(cap[0]), futuro: cap[0]?.futuro ?? 0 },
    envio: { ...faixa(env[0]), falhas: env[0]?.falhas ?? 0 },
    pontaAPonta: faixa(ponta[0]),
    vi: { ...faixa(vi[0]), enviados: vi[0]?.enviados ?? 0 },
    repasses: rep[0]?.n ?? 0,
    porPortal: conectores.map((c) => ({
      conector: c,
      nome: nomeConector(c),
      captura: faixa(capPorConector.get(c)),
      futuro: capPorConector.get(c)?.futuro ?? 0,
      pontaAPonta: pontaPorConector.get(c) ?? faixa(undefined),
      ultimaCaptura: ultimaPorConector.get(c) ?? null,
    })),
    serie: serie.map((r) => ({
      dia: r.dia, novas: r.novas,
      capturaP95: r.captura_p95 == null ? null : Math.round(r.captura_p95),
      pontaP95: r.ponta_p95 == null ? null : Math.round(r.ponta_p95),
    })),
    porStatus: status,
    fila: { pendentes: fila[0]?.pendentes ?? 0, maisAntigoMin: fila[0]?.mais_antigo_min ?? null },
    semCapturaHaMin: Number.isFinite(ultima) ? Math.round((Date.now() - ultima) / 60_000) : null,
  }
}
