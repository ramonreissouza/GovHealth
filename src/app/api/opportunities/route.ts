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
import { carregarIndiceCapag, type IndiceCapag } from '@/lib/capacidade-pagamento'
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
  'imagem', 'uti', 'laboratorio', 'cirurgia', 'oncologia', 'medicamento',
  'material_hospitalar', 'equipamento_medico', 'servicos_medicos',
  'odontologia', 'ambulancia', 'manutencao', 'opme', 'outros',
])

// Só entra em ação quando o registro não tem categoria_saude no banco (ex.: dado
// vindo direto do PNCP ao vivo). A ordem espelha scripts/saude-filter.mjs — se
// divergir, a mesma licitação muda de categoria conforme a origem.
function inferirCategoria(objeto: string): Oportunidade['categoria'] {
  const l = objeto.toLowerCase()
  if (/tomógraf|tomografia|ressonância|ultrassom|raio.?x|mamógraf|radiolog|monitor.*fetal|frequência cardíaca/.test(l)) return 'imagem'
  if (/uti|ventilador|respirador|monitor|desfibrilador|bomba de infusão|oxímetro|cânula|traqueostomia|leito/.test(l)) return 'uti'
  if (/laboratóri|analisador|hematológ|bioquím|reagente/.test(l)) return 'laboratorio'
  if (/cirurgia|cirúrg|bisturi|mesa cirúrg/.test(l)) return 'cirurgia'
  if (/oncolog|quimioterap|radioterap/.test(l)) return 'oncologia'
  if (/medicament|fármac|vacina|soro fisiol|medicinal/.test(l)) return 'medicamento'
  if (/odontológ|dentári|dentist|bucal|endôdont|ortodônt|periodont/.test(l)) return 'odontologia'
  if (/ambulânci|\bsamu\b|remoção de paciente|transporte de paciente/.test(l)) return 'ambulancia'
  if (/prótese|órtese|implantes?[^a-z]|implantável|stent|marca.?passo/.test(l)) return 'opme'
  if (/manutenção (preventiva|corretiva|de equipament)|corretiva e preventiva|preventiva e corretiva|assistência técnica|calibração/.test(l)) return 'manutencao'
  if (/prestação de serviços? (médic|de saúde|especializ)|atendimento (médic|especializ)|credenciamento|plantão|hemodiálise|diálise/.test(l)) return 'servicos_medicos'
  if (/material (médic|hospitalar|penso)|materiais (médic|hospitalar)|insumo|descartáv|seringa|agulha|cateter|gaze|atadura|luva|curativo|fralda|sutura/.test(l)) return 'material_hospitalar'
  if (/equipament|aparelh|instrumental|mobiliário|materia(l|is) permanente|autoclave|cadeira de rodas|nebuliz|incubadora/.test(l)) return 'equipamento_medico'
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

// Enriquece a oportunidade com a capacidade de pagamento (CAPAG) da instituição e
// mistura como fator aditivo ponderado (15%) no score: score' = 0,85·base + 0,15·cap.
// Sem dado (federal/União ou ente sem CAPAG) → neutro, não distorce o lead.
function aplicarCapacidade(o: Oportunidade, idx: IndiceCapag): Oportunidade {
  const cap = idx.resolvePublico(o.uf, o.municipio)
  const score = Math.round(0.85 * o.score + 0.15 * cap.score)
  return {
    ...o,
    score,
    status: score >= 75 ? 'quente' : score >= 50 ? 'morno' : 'frio',
    subScores: { ...o.subScores, capacidade: cap.score },
    capacidadePagamento: { fonte: cap.fonte, nota: cap.nota, label: cap.label },
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
  fonte: string | null
  link_externo: string | null
  aberto: boolean
}

// aberto = ainda SEM resultado homologado; encerrada = já tem vencedor definido.
// (situacao_id do PNCP é desatualizado no banco; a presença de resultado é o sinal
// confiável de que a licitação encerrou.)
const abertoExpr = (ref: string) =>
  `NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = ${ref}.numero_controle_pncp)`

// Filtros SQL compartilhados por buscarDoBanco / totaisDoBanco (mesmo universo).
interface FiltroBanco {
  uf?: string
  ufs?: string[]
  municipio?: string
  tipo?: TipoFornecimento
  status?: 'aberto' | 'encerrado' | 'todos'
  ano?: string
  categoria?: string
}
function construirWhere(params: FiltroBanco, opts: { incluirTipo?: boolean } = {}): { whereSql: string; args: unknown[] } {
  // Fontes fora do PNCP (ex.: Licitações-e/BB) não expõem valor na listagem pública,
  // então o piso de R$10k não se aplica a elas — senão sumiriam por terem valor nulo.
  // Ao filtrar por CIDADE específica (deep-link do mapa) o piso é dispensado: o usuário
  // quer ver TODAS as licitações daquela cidade e a contagem bate com o mapa.
  const where: string[] = ["objeto_compra IS NOT NULL"]
  if (!params.municipio) where.unshift("(valor_total_estimado >= 10000 OR fonte <> 'pncp')")
  const args: unknown[] = []
  if (params.ufs?.length) { args.push(params.ufs); where.push(`uf = ANY($${args.length})`) }
  else if (params.uf) { args.push(params.uf.toUpperCase()); where.push(`uf = $${args.length}`) }
  if (params.municipio) { args.push(params.municipio); where.push(`UPPER(TRIM(municipio)) = UPPER(TRIM($${args.length}))`) }
  if (opts.incluirTipo !== false && params.tipo) { args.push(params.tipo); where.push(`tipo_fornecimento = $${args.length}`) }
  if (params.categoria) { args.push(params.categoria); where.push(`categoria_saude = $${args.length}`) }
  if (params.ano && /^\d{4}$/.test(params.ano)) { args.push(Number(params.ano)); where.push(`EXTRACT(YEAR FROM data_publicacao) = $${args.length}`) }
  if (params.status === 'aberto') where.push(abertoExpr('contratacoes'))
  else if (params.status === 'encerrado') where.push(`NOT ${abertoExpr('contratacoes')}`)
  return { whereSql: where.join(' AND '), args }
}

// Totais REAIS do filtro (não da página carregada) — para os KPIs refletirem todo
// o universo selecionado, não só as N linhas renderizadas.
export interface TotaisBanco { total: number; valorTotal: number; abertas: number; estados: number }
async function totaisDoBanco(params: FiltroBanco): Promise<TotaisBanco> {
  const cacheKey = `opp:totais:${params.ufs?.join(',') ?? params.uf ?? ''}:${params.municipio ?? ''}:${params.tipo ?? ''}:${params.status ?? ''}:${params.ano ?? ''}:${params.categoria ?? ''}`
  const cached = getCached<TotaisBanco>(cacheKey)
  if (cached) return cached
  const { whereSql, args } = construirWhere(params)
  const [row] = await query<TotaisBanco>(
    `SELECT count(*)::int AS total,
            COALESCE(sum(valor_total_estimado), 0)::float8 AS "valorTotal",
            count(*) FILTER (WHERE ${abertoExpr('contratacoes')})::int AS abertas,
            count(DISTINCT uf)::int AS estados
       FROM contratacoes WHERE ${whereSql}`,
    args,
  )
  return setCached(cacheKey, row ?? { total: 0, valorTotal: 0, abertas: 0, estados: 0 }, TTL.SHORT)
}

// Contagem por tipo de fornecimento (para as abas), SEM o filtro de tipo — assim
// todas as abas mostram seu total dentro do filtro de status/ano/categoria.
async function porTipoDoBanco(params: FiltroBanco): Promise<Record<string, number>> {
  const cacheKey = `opp:portipo:${params.ufs?.join(',') ?? params.uf ?? ''}:${params.municipio ?? ''}:${params.status ?? ''}:${params.ano ?? ''}:${params.categoria ?? ''}`
  const cached = getCached<Record<string, number>>(cacheKey)
  if (cached) return cached
  const { whereSql, args } = construirWhere(params, { incluirTipo: false })
  const rows = await query<{ tipo: string; n: number }>(
    `SELECT COALESCE(tipo_fornecimento, 'outros') AS tipo, count(*)::int AS n
       FROM contratacoes WHERE ${whereSql} GROUP BY 1`,
    args,
  )
  const map: Record<string, number> = {}
  for (const r of rows) map[r.tipo] = r.n
  return setCached(cacheKey, map, TTL.SHORT)
}

// Fonte primária: banco. Retorna null quando indisponível/vazio (sinal p/ fallback PNCP).
async function buscarDoBanco(params: {
  uf?: string
  ufs?: string[]
  municipio?: string
  tipo?: TipoFornecimento
  porUf?: number // amostra por UF (mapa): top-N por UF, cobertura geográfica
  status?: 'aberto' | 'encerrado' | 'todos'
  ano?: string
  categoria?: string
  limit?: number
  agora: string
}): Promise<Oportunidade[] | null> {
  const cacheKey = `opp:banco:${params.ufs?.length ? params.ufs.join(',') : params.uf ?? ''}:${params.municipio ?? ''}:${params.tipo ?? ''}:${params.porUf ?? ''}:${params.status ?? ''}:${params.ano ?? ''}:${params.categoria ?? ''}:${params.limit ?? ''}`
  const cached = getCached<Oportunidade[]>(cacheKey)
  if (cached) return cached

  const { whereSql, args } = construirWhere(params)

  const cols = `numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
            modalidade_nome, objeto_compra, ano_compra, sequencial_compra,
            valor_total_estimado::float8 AS valor_total_estimado,
            to_char(data_publicacao, 'YYYY-MM-DD') AS data_publicacao,
            situacao_id, categoria_saude, tipo_fornecimento, fonte, link_externo`
  const lim = Math.min(Math.max(Math.floor(params.limit ?? 4000), 1), 4000)

  // Modo mapa: top-N por UF (janela) → toda UF com dado aparece, sem viés de recência.
  // Caso contrário: os N mais recentes (o dashboard/lista querem prioridade temporal).
  const sql = params.porUf
    ? `SELECT ${cols}, aberto FROM (
         SELECT *, ${abertoExpr('contratacoes')} AS aberto,
                ROW_NUMBER() OVER (PARTITION BY uf ORDER BY valor_total_estimado DESC NULLS LAST) AS rn
         FROM contratacoes WHERE ${whereSql}
       ) c WHERE rn <= ${Math.min(Math.max(Math.floor(params.porUf), 1), 100)}`
    : `SELECT ${cols}, ${abertoExpr('contratacoes')} AS aberto FROM contratacoes WHERE ${whereSql} ORDER BY data_publicacao DESC NULLS LAST LIMIT ${lim}`

  const rows = await query<ContratacaoRow>(sql, args)

  if (!rows.length) return null

  const ops = rows.map((r) => {
    const uf = r.uf ?? 'N/D'
    const cnpj = r.cnpj_orgao ?? ''
    // Fontes externas (Licitações-e) trazem o link do detalhe em link_externo; o PNCP
    // monta a URL canônica do edital a partir de cnpj/ano/sequencial.
    const link = r.link_externo
      ? r.link_externo
      : cnpj && r.ano_compra && r.sequencial_compra
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
      // Status por resultado homologado (não pelo situacao_id, desatualizado).
      situacaoCompraId: r.aberto ? 1 : 4,
      situacaoCompraNome: r.aberto ? 'Em aberto' : 'Encerrada (homologada)',
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
      aberto: r.aberto,
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

async function agregadosDoBanco(params: { uf?: string; ufs?: string[]; tipo?: TipoFornecimento }): Promise<{
  serieMensal: SerieMensalRow[]
  porCategoria: PorCategoriaRow[]
}> {
  const cacheKey = `opp:agg:${params.ufs?.length ? params.ufs.join(',') : params.uf ?? ''}:${params.tipo ?? ''}`
  const cached = getCached<{ serieMensal: SerieMensalRow[]; porCategoria: PorCategoriaRow[] }>(cacheKey)
  if (cached) return cached

  const where: string[] = ['valor_total_estimado >= 10000']
  const args: unknown[] = []
  if (params.ufs?.length) { args.push(params.ufs); where.push(`uf = ANY($${args.length})`) }
  else if (params.uf) { args.push(params.uf.toUpperCase()); where.push(`uf = $${args.length}`) }
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
    const ufsParam = searchParams.get('ufs') ?? undefined // território multi-UF ("CE,BA,PE")
    const ufs = ufsParam ? ufsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined
    const municipio = searchParams.get('municipio')?.trim() || undefined // filtro por cidade (deep-link do mapa)
    const porUf = searchParams.get('porUf') ? Number(searchParams.get('porUf')) : undefined // amostra por UF (mapa)
    const minScore = Number(searchParams.get('minScore') ?? 0)
    const categoria = searchParams.get('categoria') ?? undefined
    const regiao = searchParams.get('regiao') ?? undefined
    const tipoParam = searchParams.get('tipo') ?? undefined
    const tipo = tipoParam && tipoParam !== 'todos' && isTipoFornecimento(tipoParam) ? tipoParam : undefined
    const statusParam = searchParams.get('status') ?? undefined
    const status = statusParam === 'aberto' || statusParam === 'encerrado' ? statusParam : undefined
    const anoParam = searchParams.get('ano') ?? undefined
    const ano = anoParam && /^\d{4}$/.test(anoParam) ? anoParam : undefined
    const limit = Number(searchParams.get('limit') ?? 100)
    const agora = new Date().toISOString()

    // 1) Banco (primário). 2) PNCP ao vivo (fallback) se o banco vier vazio/indisponível.
    let oportunidades: Oportunidade[] = []
    let fonte = 'Banco GovHealth (ETL PNCP)'
    let avisos: string[] = []
    let serieMensal: SerieMensalRow[] = []
    let porCategoria: PorCategoriaRow[] = []
    // Totais REAIS do filtro (todo o universo, não só as N linhas carregadas).
    let totais: TotaisBanco | null = null
    let porTipo: Record<string, number> | null = null

    try {
      const [doBanco, tot, pt] = await Promise.all([
        buscarDoBanco({ uf, ufs, municipio, tipo, porUf, status, ano, categoria, limit, agora }),
        porUf ? Promise.resolve(null) : totaisDoBanco({ uf, ufs, municipio, tipo, status, ano, categoria }),
        porUf ? Promise.resolve(null) : porTipoDoBanco({ uf, ufs, municipio, status, ano, categoria }),
      ])
      totais = tot
      porTipo = pt
      if (doBanco && doBanco.length) {
        oportunidades = doBanco
        const agg = await agregadosDoBanco({ uf, ufs, tipo }) // gráficos sobre o dataset completo
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

    // Capacidade de pagamento (CAPAG): enriquece o score de cada lead com a saúde
    // fiscal do órgão pagador. Índice carregado em lote (cacheado) para as UFs presentes.
    try {
      const ufsPresentes = [...new Set(oportunidades.map((o) => o.uf).filter((u) => u && u !== 'N/D'))]
      const capagIdx = await carregarIndiceCapag(ufsPresentes.length ? ufsPresentes : undefined)
      oportunidades = oportunidades.map((o) => aplicarCapacidade(o, capagIdx))
    } catch (capErr) {
      console.warn('[opportunities] capacidade de pagamento indisponível:', String(capErr))
    }

    // Dedup pelo ID REAL da licitação (nº de controle PNCP). Antes deduplicava por
    // município+categoria+valor, o que FUNDIA licitações distintas da mesma cidade com
    // mesma categoria e valor (compras repetidas) — sumindo com processos reais e não
    // batendo com a contagem/o mapa. Por controle, só remove duplicata verdadeira.
    const seen = new Set<string>()
    let resultado = oportunidades.filter((o) => {
      const k = o.licitacaoRelacionada?.numeroControlePNCP ?? o.id
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

    // Totais do filtro: preferir o agregado do banco (universo completo). Sem ele
    // (PNCP/porUf), cai para os totais do conjunto carregado.
    const totaisFinal: TotaisBanco = totais ?? {
      total: resultado.length,
      valorTotal: resultado.reduce((s, o) => s + o.valorEstimado, 0),
      abertas: resultado.filter((o) => o.licitacaoRelacionada?.situacaoCompraId === 1).length,
      estados: new Set(resultado.map((o) => o.uf)).size,
    }

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
      totais: totaisFinal,
      porTipo,
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
