// src/app/api/opportunities/route.ts
// Oportunidades de saúde para o dashboard.
// Fonte PRIMÁRIA: banco (contratacoes coletadas pelo ETL) — resiliente e rápido.
// Fallback: PNCP ao vivo, usado só quando o banco está indisponível/vazio
// (ex.: DATABASE_URL ausente ou tabela ainda não populada). Assim o dashboard
// não fica em branco quando o PNCP está fora do ar.

import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, normalizarLicitacao } from '@/lib/pncp'
import { classificarTipo } from '@/lib/score-engine'
import { query } from '@/lib/db'
import { isTipoFornecimento } from '@/lib/tipo-sql'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { ultimaColetaResultados } from '@/lib/coleta-meta'
import { Oportunidade, Licitacao, TipoFornecimento } from '@/lib/types'

export const runtime = 'nodejs'
export const revalidate = 1800
export const maxDuration = 60

function inferirRegiao(uf: string): string {
  const r: Record<string, string> = {
    AC:'norte',AM:'norte',AP:'norte',PA:'norte',RO:'norte',RR:'norte',TO:'norte',
    AL:'nordeste',BA:'nordeste',CE:'nordeste',MA:'nordeste',PB:'nordeste',PE:'nordeste',PI:'nordeste',RN:'nordeste',SE:'nordeste',
    DF:'centro-oeste',GO:'centro-oeste',MS:'centro-oeste',MT:'centro-oeste',
    ES:'sudeste',MG:'sudeste',RJ:'sudeste',SP:'sudeste',
    PR:'sul',RS:'sul',SC:'sul',
  }
  return r[uf] ?? 'outros'
}

const CATEGORIAS_VALIDAS = new Set<Oportunidade['categoria']>([
  'imagem', 'uti', 'laboratorio', 'cirurgia', 'oncologia', 'medicamento', 'outros',
])

function inferirCategoria(objeto: string): Oportunidade['categoria'] {
  const l = objeto.toLowerCase()
  if (/tomógraf|tomografia|ressonância|ultrassom|raio.?x|mamógraf|radiolog|monitor.*fetal|frequência cardíaca/.test(l)) return 'imagem'
  if (/uti|ventilador|respirador|monitor|desfibrilador|bomba de infusão|oxímetro|cânula|traqueostomia|leito/.test(l)) return 'uti'
  if (/laboratóri|analisador|hematológ|bioquím|reagente/.test(l)) return 'laboratorio'
  if (/cirurgia|cirúrg|bisturi|mesa cirúrg/.test(l)) return 'cirurgia'
  if (/oncolog|quimioterap|radioterap/.test(l)) return 'oncologia'
  return 'outros'
}

// Monta a Oportunidade a partir de campos já normalizados (comum ao banco e ao PNCP).
function montarOportunidade(input: {
  id: string
  licitacao: Licitacao
  objeto: string
  uf: string
  municipio: string
  hospital: string
  valor: number
  aberto: boolean
  categoria?: Oportunidade['categoria']
  tipo?: TipoFornecimento
  agora: string
}): Oportunidade {
  const { objeto, uf, municipio, hospital, valor, aberto, agora } = input
  const cat = input.categoria ?? inferirCategoria(objeto)
  const score = aberto ? 85 : 70
  return {
    id: input.id,
    municipio,
    uf,
    regiao: inferirRegiao(uf),
    hospital,
    categoria: cat,
    descricao: objeto.substring(0, 140),
    score,
    subScores: { convenio: 80, historico: 65, orgao: 75, competicao: 60 },
    tipoFornecimento: input.tipo ?? classificarTipo(objeto),
    valorEstimado: valor,
    janelaEmDias: aberto ? 0 : 30,
    urgencia: aberto ? 'urgente' : 'alta',
    status: score >= 75 ? 'quente' : 'morno',
    probabilidadeEdital: aberto ? 1 : 0.7,
    concorrentes: [],
    indiceConcorrencia: 'medio',
    acaoRecomendada: aberto ? 'Edital publicado — preparar proposta' : 'Monitorar — licitação prevista',
    licitacaoRelacionada: input.licitacao,
    createdAt: agora,
    updatedAt: agora,
  }
}

interface ContratacaoRow {
  numero_controle_pncp: string
  cnpj_orgao: string
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
  tipo_fornecimento: string | null
}

// Fonte primária: banco. Retorna null quando indisponível/vazio (sinal p/ fallback PNCP).
async function buscarDoBanco(params: {
  uf?: string
  tipo?: TipoFornecimento
  agora: string
}): Promise<Oportunidade[] | null> {
  const cacheKey = `opp:banco:${params.uf ?? ''}:${params.tipo ?? ''}`
  const cached = getCached<Oportunidade[]>(cacheKey)
  if (cached) return cached

  const where: string[] = ['valor_total_estimado >= 10000', "objeto_compra IS NOT NULL"]
  const args: unknown[] = []
  if (params.uf) { args.push(params.uf.toUpperCase()); where.push(`uf = $${args.length}`) }
  if (params.tipo) { args.push(params.tipo); where.push(`tipo_fornecimento = $${args.length}`) }

  const rows = await query<ContratacaoRow>(
    `SELECT numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
            modalidade_nome, objeto_compra, ano_compra, sequencial_compra,
            valor_total_estimado::float8 AS valor_total_estimado,
            to_char(data_publicacao, 'YYYY-MM-DD') AS data_publicacao,
            situacao_id, categoria_saude, tipo_fornecimento
     FROM contratacoes
     WHERE ${where.join(' AND ')}
     ORDER BY data_publicacao DESC NULLS LAST
     LIMIT 4000`,
    args,
  )

  if (!rows.length) return null

  const ops = rows.map((r) => {
    const uf = r.uf ?? 'N/D'
    const cnpj = r.cnpj_orgao ?? ''
    const link = cnpj && r.ano_compra && r.sequencial_compra
      ? `https://pncp.gov.br/app/editais/${cnpj}/${r.ano_compra}/${r.sequencial_compra}`
      : 'https://pncp.gov.br'
    const licitacao: Licitacao = {
      id: r.numero_controle_pncp,
      numeroControlePNCP: r.numero_controle_pncp,
      orgaoEntidade: {
        cnpj,
        razaoSocial: r.razao_social_orgao ?? 'N/D',
        municipio: r.municipio ?? undefined,
        uf: r.uf ?? undefined,
      },
      modalidadeNome: r.modalidade_nome ?? 'N/D',
      objetoCompra: r.objeto_compra ?? '',
      valorTotalEstimado: r.valor_total_estimado ?? 0,
      dataPublicacaoPncp: r.data_publicacao ?? '',
      situacaoCompraId: r.situacao_id ?? 0,
      situacaoCompraNome: r.situacao_id === 1 ? 'Divulgada no PNCP' : 'Encerrada',
      linkSistemaOrigem: link,
    }
    const catBanco = r.categoria_saude as Oportunidade['categoria'] | null
    return montarOportunidade({
      id: `pncp-${r.numero_controle_pncp}`,
      licitacao,
      objeto: r.objeto_compra ?? '',
      uf,
      municipio: r.municipio ?? 'N/D',
      hospital: r.razao_social_orgao ?? 'N/D',
      valor: r.valor_total_estimado ?? 0,
      aberto: r.situacao_id === 1,
      categoria: catBanco && CATEGORIAS_VALIDAS.has(catBanco) ? catBanco : undefined,
      tipo: isTipoFornecimento(r.tipo_fornecimento) ? r.tipo_fornecimento : undefined,
      agora: params.agora,
    })
  })

  return setCached(cacheKey, ops, TTL.SHORT)
}

// Agregados para os gráficos do dashboard — sobre o dataset COMPLETO do banco
// (não a amostra limitada), para o gráfico refletir os 12 meses reais.
interface SerieMensalRow { mes: string; count: number; valor: number }
interface PorCategoriaRow { categoria: string; count: number; valor: number }

async function agregadosDoBanco(params: { uf?: string; tipo?: TipoFornecimento }): Promise<{
  serieMensal: SerieMensalRow[]
  porCategoria: PorCategoriaRow[]
}> {
  const cacheKey = `opp:agg:${params.uf ?? ''}:${params.tipo ?? ''}`
  const cached = getCached<{ serieMensal: SerieMensalRow[]; porCategoria: PorCategoriaRow[] }>(cacheKey)
  if (cached) return cached

  const where: string[] = ['valor_total_estimado >= 10000']
  const args: unknown[] = []
  if (params.uf) { args.push(params.uf.toUpperCase()); where.push(`uf = $${args.length}`) }
  if (params.tipo) { args.push(params.tipo); where.push(`tipo_fornecimento = $${args.length}`) }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const [serie, cats] = await Promise.all([
    query<SerieMensalRow>(
      `SELECT to_char(date_trunc('month', data_publicacao), 'YYYY-MM') AS mes,
              COUNT(*)::int AS count,
              COALESCE(SUM(valor_total_estimado), 0)::float8 AS valor
       FROM contratacoes
       ${whereSql} AND data_publicacao >= (date_trunc('month', now()) - interval '11 months')
       GROUP BY 1 ORDER BY 1`,
      args,
    ),
    query<PorCategoriaRow>(
      `SELECT COALESCE(NULLIF(categoria_saude, ''), 'outros') AS categoria,
              COUNT(*)::int AS count,
              COALESCE(SUM(valor_total_estimado), 0)::float8 AS valor
       FROM contratacoes ${whereSql} GROUP BY 1 ORDER BY count DESC`,
      args,
    ),
  ])
  return setCached(cacheKey, { serieMensal: serie, porCategoria: cats }, TTL.SHORT)
}

// Fallback: PNCP ao vivo (comportamento antigo). Só roda se o banco não devolveu nada.
async function buscarDoPNCP(params: { uf?: string; agora: string }): Promise<{ ops: Oportunidade[]; erros: string[] }> {
  const pncp = await buscarComprasSaude({ uf: params.uf, maxPaginasPorModalidade: 5 })
  const ops: Oportunidade[] = []
  for (const raw of pncp.data) {
    const lic = normalizarLicitacao(raw)
    if (!lic.valorTotalEstimado || lic.valorTotalEstimado < 10_000) continue
    const uf = lic.orgaoEntidade.uf ?? 'N/D'
    const aberto = lic.situacaoCompraId === 1 || /receb|aberto|divulg/i.test(lic.situacaoCompraNome ?? '')
    ops.push(montarOportunidade({
      id: `pncp-${lic.id}`,
      licitacao: lic,
      objeto: lic.objetoCompra,
      uf,
      municipio: lic.orgaoEntidade.municipio ?? 'N/D',
      hospital: lic.orgaoEntidade.razaoSocial,
      valor: lic.valorTotalEstimado,
      aberto,
      agora: params.agora,
    }))
  }
  return { ops, erros: pncp.erros ?? [] }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const uf = searchParams.get('uf') ?? undefined
    const minScore = Number(searchParams.get('minScore') ?? 0)
    const categoria = searchParams.get('categoria') ?? undefined
    const regiao = searchParams.get('regiao') ?? undefined
    const tipoParam = searchParams.get('tipo') ?? undefined
    const tipo = tipoParam && tipoParam !== 'todos' && isTipoFornecimento(tipoParam) ? tipoParam : undefined
    const limit = Number(searchParams.get('limit') ?? 100)
    const agora = new Date().toISOString()

    // 1) Banco (primário). 2) PNCP ao vivo (fallback) se o banco vier vazio/indisponível.
    let oportunidades: Oportunidade[] = []
    let fonte = 'Banco GovHealth (ETL PNCP)'
    let avisos: string[] = []
    let serieMensal: SerieMensalRow[] = []
    let porCategoria: PorCategoriaRow[] = []

    try {
      const doBanco = await buscarDoBanco({ uf, tipo, agora })
      if (doBanco && doBanco.length) {
        oportunidades = doBanco
        const agg = await agregadosDoBanco({ uf, tipo }) // gráficos sobre o dataset completo
        serieMensal = agg.serieMensal
        porCategoria = agg.porCategoria
      } else {
        const pncp = await buscarDoPNCP({ uf, agora })
        oportunidades = tipo ? pncp.ops.filter((o) => o.tipoFornecimento === tipo) : pncp.ops
        fonte = 'PNCP (tempo real)'
        avisos = pncp.erros
      }
    } catch (dbErr) {
      // Banco indisponível (ex.: DATABASE_URL ausente) → cai para o PNCP ao vivo.
      console.warn('[opportunities] banco indisponível, usando PNCP ao vivo:', String(dbErr))
      const pncp = await buscarDoPNCP({ uf, agora })
      oportunidades = tipo ? pncp.ops.filter((o) => o.tipoFornecimento === tipo) : pncp.ops
      fonte = 'PNCP (tempo real)'
      avisos = pncp.erros
    }

    // Fallback dos agregados: se vieram do PNCP (sem SQL), calcula a partir das ops.
    if (!serieMensal.length) {
      const mAcc: Record<string, { count: number; valor: number }> = {}
      const cAcc: Record<string, { count: number; valor: number }> = {}
      for (const o of oportunidades) {
        const mes = o.licitacaoRelacionada?.dataPublicacaoPncp?.substring(0, 7)
        if (mes) {
          mAcc[mes] ??= { count: 0, valor: 0 }
          mAcc[mes].count++; mAcc[mes].valor += o.valorEstimado
        }
        cAcc[o.categoria] ??= { count: 0, valor: 0 }
        cAcc[o.categoria].count++; cAcc[o.categoria].valor += o.valorEstimado
      }
      serieMensal = Object.entries(mAcc).map(([mes, v]) => ({ mes, ...v })).sort((a, b) => a.mes.localeCompare(b.mes))
      porCategoria = Object.entries(cAcc).map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => b.count - a.count)
    }

    // Dedup por município+categoria+valor
    const seen = new Set<string>()
    let resultado = oportunidades.filter((o) => {
      const k = `${o.municipio}-${o.uf}-${o.categoria}-${o.valorEstimado}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

    if (minScore > 0) resultado = resultado.filter((o) => o.score >= minScore)
    if (categoria) resultado = resultado.filter((o) => o.categoria === categoria)
    if (regiao) resultado = resultado.filter((o) => o.regiao === regiao)

    resultado = resultado
      .sort((a, b) => b.score - a.score || (b.licitacaoRelacionada?.dataPublicacaoPncp ?? '').localeCompare(a.licitacaoRelacionada?.dataPublicacaoPncp ?? ''))
      .slice(0, limit)

    return NextResponse.json({
      oportunidades: resultado,
      kpis: {
        total: resultado.length,
        quentes: resultado.filter((o) => o.status === 'quente').length,
        valorTotal: resultado.reduce((s, o) => s + o.valorEstimado, 0),
        scoreMedio: resultado.length
          ? Math.round(resultado.reduce((s, o) => s + o.score, 0) / resultado.length)
          : 0,
      },
      serieMensal,
      porCategoria,
      fonte,
      avisos,
      // Selo de proveniência: quando vem do banco, usa a data REAL da última coleta
      // do ETL (não a hora do request) — corrige o "atualizado agora" genérico.
      atualizadoEm: fonte.startsWith('Banco') ? ((await ultimaColetaResultados()) ?? agora) : agora,
    })
  } catch (error) {
    console.error('[opportunities]', error)
    return NextResponse.json({ error: 'Erro ao calcular oportunidades', detalhe: String(error) }, { status: 500 })
  }
}
