// src/lib/portais-estaduais-db.ts — SERVER-ONLY (importa pg via ./db).
//
// Fonte primária dos Portais Estaduais: o banco (ETL nacional, 27 UFs). Usá-lo dá
// contagens estáveis e proporcionais (SP > MG > …) em vez da amostra rasa/
// rate-limitada do PNCP ao vivo, que produzia absurdos (ex.: RS=0 e AL>RJ).
// "Em aberto" = situacao_id = 1 (Divulgada no PNCP), mesma convenção do resto da
// plataforma. Se o banco estiver indisponível/vazio, cai para a varredura ao vivo.
//
// NÃO importar este arquivo em componentes client — use `portais-estaduais.ts`
// (client-safe) para tipos/constantes.

import { query } from './db'
import { inferirCategoria } from './score-engine'
import {
  PORTAIS_CONFIG,
  TODAS_UFS,
  kpisVazio,
  buscarResumoEstadosLive,
  buscarLicitacoesEstadoLive,
  type UFEstadual,
  type LicitacaoEstadual,
  type KPIsEstado,
  type ResumoEstados,
  type ResultadoEstado,
} from './portais-estaduais'

// Aproximação SQL para "entidade estadual de saúde" (indicador secundário nos
// cards). Case-insensitive; cobre secretarias estaduais / SES / governo do estado.
const RE_ENTIDADE_ESTADUAL =
  'secretaria.{0,30}sa[úu]de|\\ySES[ /-]|governo do estado|funda[çc][ãa]o.{0,30}sa[úu]de|hospital.{0,30}estad'

// aberto = ainda SEM resultado homologado; encerrada = já tem vencedor definido.
// (situacao_id do PNCP está desatualizado no banco; presença de resultado é o
// sinal confiável de encerramento.)
const abertoExpr = (ref: string) =>
  `NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = ${ref}.numero_controle_pncp)`

interface ContratacaoDBRow {
  numero_controle_pncp: string
  cnpj_orgao: string | null
  razao_social_orgao: string | null
  municipio: string | null
  uf: string | null
  modalidade_nome: string | null
  objeto_compra: string | null
  ano_compra: number | null
  sequencial_compra: number | null
  valor_total_estimado: number | null
  data_publicacao: string | null
  situacao_id: number | null
  categoria_saude: string | null
  aberto: boolean
}

function dbRowToEstadual(r: ContratacaoDBRow): LicitacaoEstadual {
  const aberto = r.aberto
  const cat = r.categoria_saude && r.categoria_saude !== ''
    ? r.categoria_saude
    : inferirCategoria(r.objeto_compra ?? '')
  return {
    id: r.numero_controle_pncp,
    numeroExterno: r.numero_controle_pncp,
    proponente: r.razao_social_orgao ?? 'N/D',
    cnpj: r.cnpj_orgao ?? '',
    municipio: r.municipio ?? '',
    uf: r.uf ?? '',
    descricao: r.objeto_compra ?? '',
    valor: r.valor_total_estimado ?? 0,
    dataPublicacao: r.data_publicacao ?? '',
    dataEncerramento: undefined, // não coletado pelo ETL
    // 'Aberto' para casar com isAbertaLic/calcularKpis (que buscam 'aberto').
    situacao: aberto ? 'Aberto' : 'Encerrada',
    modalidade: r.modalidade_nome ?? '',
    categoria: cat,
    link: r.cnpj_orgao && r.ano_compra && r.sequencial_compra
      ? `https://pncp.gov.br/app/editais/${r.cnpj_orgao}/${r.ano_compra}/${r.sequencial_compra}`
      : 'https://pncp.gov.br',
    fonte: 'pncp',
    anoCompra: r.ano_compra ?? undefined,
    sequencialCompra: r.sequencial_compra ?? undefined,
  }
}

interface KpiAggRow { total: number; abertas: number; valor: number; entidades: number }

function aggToKpis(a: KpiAggRow): KPIsEstado {
  return {
    total: a.total,
    abertas: a.abertas,
    valorTotal: a.valor,
    ticketMedio: a.total ? Math.round(a.valor / a.total) : 0,
    entidadesEstaduais: a.entidades,
    porCategoria: {},
    topProponentes: [],
  }
}

async function buscarResumoEstadosDB(): Promise<ResumoEstados | null> {
  const rows = await query<KpiAggRow & { uf: string }>(
    `SELECT uf,
            count(*)::int AS total,
            count(*) FILTER (WHERE ${abertoExpr('c')})::int AS abertas,
            COALESCE(sum(valor_total_estimado), 0)::float8 AS valor,
            count(*) FILTER (WHERE razao_social_orgao ~* $2)::int AS entidades
       FROM contratacoes c
      WHERE uf = ANY($1)
      GROUP BY uf`,
    [TODAS_UFS, RE_ENTIDADE_ESTADUAL],
  )
  if (!rows.length) return null

  const estados: ResumoEstados['estados'] = {}
  for (const uf of TODAS_UFS) {
    estados[uf] = { kpis: kpisVazio(), fontesAtivas: { pncp: true, portalProprio: false } }
  }
  for (const r of rows) {
    const uf = r.uf as UFEstadual
    if (!TODAS_UFS.includes(uf)) continue
    estados[uf] = { kpis: aggToKpis(r), fontesAtivas: { pncp: true, portalProprio: false } }
  }
  return { estados, atualizadoEm: new Date().toISOString() }
}

async function buscarLicitacoesEstadoDB(
  uf: UFEstadual,
  status?: 'abertas' | 'fechadas',
): Promise<ResultadoEstado | null> {
  // KPIs são SEMPRE do estado inteiro (não sofrem o filtro de status da tabela).
  const agg = (await query<KpiAggRow>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ${abertoExpr('c')})::int AS abertas,
            COALESCE(sum(valor_total_estimado), 0)::float8 AS valor,
            count(*) FILTER (WHERE razao_social_orgao ~* $2)::int AS entidades
       FROM contratacoes c WHERE uf = $1`,
    [uf, RE_ENTIDADE_ESTADUAL],
  ))[0]
  if (!agg || agg.total === 0) return null

  // Filtro de status da LISTA (a tabela); encerradas são muitas, então limitamos.
  const statusWhere =
    status === 'abertas' ? ` AND ${abertoExpr('contratacoes')}`
    : status === 'fechadas' ? ` AND NOT ${abertoExpr('contratacoes')}`
    : ''
  const rows = await query<ContratacaoDBRow>(
    `SELECT numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
            modalidade_nome, objeto_compra, ano_compra, sequencial_compra,
            valor_total_estimado::float8 AS valor_total_estimado,
            to_char(data_publicacao, 'YYYY-MM-DD') AS data_publicacao,
            situacao_id, categoria_saude,
            ${abertoExpr('contratacoes')} AS aberto
       FROM contratacoes
      WHERE uf = $1${statusWhere}
      ORDER BY aberto DESC, data_publicacao DESC NULLS LAST
      LIMIT 500`,
    [uf],
  )

  return {
    uf,
    portal: PORTAIS_CONFIG[uf],
    licitacoes: rows.map(dbRowToEstadual),
    kpis: aggToKpis(agg),
    fontesAtivas: { pncp: true, portalProprio: false },
    atualizadoEm: new Date().toISOString(),
  }
}

// ── Públicas: banco primeiro, PNCP ao vivo como fallback ──────────────────────

export async function buscarResumoEstados(): Promise<ResumoEstados> {
  try {
    const db = await buscarResumoEstadosDB()
    if (db) return db
  } catch (e) {
    console.warn('[portais-estaduais] resumo via banco falhou, usando PNCP ao vivo:', String(e))
  }
  return buscarResumoEstadosLive()
}

export async function buscarLicitacoesEstado(
  uf: UFEstadual,
  status?: 'abertas' | 'fechadas',
): Promise<ResultadoEstado> {
  try {
    const db = await buscarLicitacoesEstadoDB(uf, status)
    if (db) return db
  } catch (e) {
    console.warn(`[portais-estaduais] detalhe ${uf} via banco falhou, usando PNCP ao vivo:`, String(e))
  }
  return buscarLicitacoesEstadoLive(uf)
}
