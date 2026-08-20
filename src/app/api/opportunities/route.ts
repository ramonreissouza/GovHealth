// src/app/api/opportunities/route.ts
// Oportunidades de saúde para o dashboard.
// Fonte PRIMÁRIA: banco (contratacoes coletadas pelo ETL) — resiliente e rápido.
// Fallback: PNCP ao vivo, usado só quando o banco está INDISPONÍVEL (DATABASE_URL
// ausente, timeout de conexão) ou quando a base está VAZIA de verdade — instalação
// nova, ETL nunca rodou. Assim o dashboard não fica em branco quando o banco cai.
//
// "Filtrei e não achei nada" NÃO é caso de fallback: o PNCP ao vivo não conhece os
// filtros da tela (busca livre, proponente, portfólio, status, ordenação, página), e
// responder com ele a uma busca sem correspondência mostra oportunidades alheias ao
// filtro. Zero linha do banco é resposta válida — a lista vem vazia. Ver o bloco de
// decisão no GET.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { buscarComprasSaude, normalizarLicitacao } from '@/lib/pncp'
import { needlesDoPortfolio } from '@/lib/portfolio-servidor'
import { classificarTipo } from '@/lib/score-engine'
import { query } from '@/lib/db'
import { isTipoFornecimento } from '@/lib/tipo-sql'
import { getCached, setCached, TTL } from '@/lib/server-cache'
import { ultimaColetaResultados } from '@/lib/coleta-meta'
import { carregarIndiceCapag, type IndiceCapag } from '@/lib/capacidade-pagamento'
import { normalizeText } from '@/lib/text'
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
  usuario_nome: string | null
  aberto: boolean
}

// aberto = ainda SEM resultado homologado; encerrada = já tem vencedor definido.
// (situacao_id do PNCP é desatualizado no banco; a presença de resultado é o sinal
// confiável de que a licitação encerrou.)
const abertoExpr = (ref: string) =>
  `NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = ${ref}.numero_controle_pncp)`

// Busca textual tolerante a acento SEM a extensão `unaccent` (não instalada) — mesmo
// padrão de src/lib/radar/selecao.ts. `objeto_compra` tem índice trigram sobre ESTA
// expressão exata (idx_contratacoes_objeto_trgm, scripts/migrate-trgm.mjs) — mudar o
// mapa de acentos aqui exige recriar o índice lá.
const SEM_ACENTO_DE = 'áàâãäéèêëíìîïóòôõöúùûüçñ'
const SEM_ACENTO_PARA = 'aaaaaeeeeiiiiooooouuuucn'
const semAcento = (expr: string) => `translate(lower(${expr}), '${SEM_ACENTO_DE}', '${SEM_ACENTO_PARA}')`

// Score em SQL, espelhando montarOportunidade+aplicarCapacidade (route.ts) e a nota
// CAPAG (src/lib/capacidade-pagamento.ts: SCORE_POR_NOTA, NEUTRO_SCORE=60,
// resolvePublico — município, senão estado, senão neutro). Permite ORDER BY/WHERE
// por score sobre o universo inteiro, não só a amostra carregada. ATENÇÃO: mudar a
// fórmula do score em qualquer um dos dois lados (JS ou aqui) exige mudar o outro —
// mesmo risco de deriva já aceito para a expressão de acento acima.
const scoreExprSql = (ref: string) => `ROUND(
  0.85 * (CASE WHEN ${abertoExpr(ref)} THEN 85 ELSE 70 END)
  + 0.15 * COALESCE(
      (SELECT CASE cap_m.nota WHEN 'A' THEN 100 WHEN 'B' THEN 70 WHEN 'C' THEN 40 WHEN 'D' THEN 10 END
         FROM capag cap_m
        WHERE cap_m.ente_tipo = 'municipio' AND cap_m.uf = ${ref}.uf
          AND cap_m.municipio_key = UPPER(${semAcento(`${ref}.municipio`)})
        LIMIT 1),
      (SELECT CASE cap_e.nota WHEN 'A' THEN 100 WHEN 'B' THEN 70 WHEN 'C' THEN 40 WHEN 'D' THEN 10 END
         FROM capag cap_e WHERE cap_e.ente_tipo = 'estado' AND cap_e.uf = ${ref}.uf LIMIT 1),
      60
    )
)`

// Tokeniza a busca livre como matchesTermo (src/lib/text.ts): por espaço, tolerante a
// plural simples. Teto de 8 termos — corte defensivo contra input patológico.
function termosBusca(q: string): string[] {
  return normalizeText(q).split(/\s+/).filter(Boolean).slice(0, 8)
}
function variantesTermo(termo: string): string[] {
  const vs = new Set([termo])
  if (termo.endsWith('s') && termo.length > 1) vs.add(termo.slice(0, -1))
  return [...vs].map((v) => `%${v}%`)
}

// Filtros SQL compartilhados por buscarDoBanco / totaisDoBanco (mesmo universo).
interface FiltroBanco {
  uf?: string
  ufs?: string[]
  municipio?: string
  tipo?: TipoFornecimento
  status?: 'aberto' | 'encerrado' | 'todos'
  ano?: string
  categoria?: string
  /** Busca livre (proponente/município/objeto/CNPJ/PNCP/itens) — cada termo AND. */
  q?: string
  /** Busca só pelo nome do proponente (razão social). */
  proponente?: string
  /** Busca pelo nº de controle PNCP / convênio. */
  convenio?: string
  /** Palavras-chave do portfólio ativo, resolvidas na CONTA (portfolio-servidor.ts). */
  portfolioNeedles?: string[]
  /** "Meu Portfólio" ligado mas sem nenhum produto ativo na conta. */
  portfolioVazio?: boolean
  /** Score mínimo (calculado em SQL — ver scoreExprSql). */
  minScore?: number
}
function construirWhere(params: FiltroBanco, opts: { incluirTipo?: boolean } = {}): { whereSql: string; args: unknown[] } {
  // Fontes fora do PNCP (ex.: Licitações-e/BB) não expõem valor na listagem pública,
  // então o piso de R$10k não se aplica a elas — senão sumiriam por terem valor nulo.
  // Ao filtrar por CIDADE específica (deep-link do mapa) o piso é dispensado: o usuário
  // quer ver TODAS as licitações daquela cidade e a contagem bate com o mapa.
  const where: string[] = ["objeto_compra IS NOT NULL"]
  // O piso corta o que SABIDAMENTE é pequeno — não o que está sem valor informado.
  // Medido na base: das 331.177 contratações, 238.036 (72%) não têm valor porque a
  // API de busca do PNCP não devolve o campo; só 29.274 são de fato < R$ 10 mil. Com
  // o NULL caindo no piso, Licitações escondia 72% da base e contradizia o Mapa
  // (306.975 abertas lá contra 50.241 aqui) — e uma licitação relevante ficava
  // invisível por um dado que faltou na coleta, não por ser irrelevante.
  if (!params.municipio) where.unshift("(valor_total_estimado IS NULL OR valor_total_estimado >= 10000 OR fonte <> 'pncp')")
  const args: unknown[] = []
  if (params.ufs?.length) { args.push(params.ufs); where.push(`uf = ANY($${args.length})`) }
  else if (params.uf) { args.push(params.uf.toUpperCase()); where.push(`uf = $${args.length}`) }
  if (params.municipio) { args.push(params.municipio); where.push(`UPPER(TRIM(municipio)) = UPPER(TRIM($${args.length}))`) }
  if (opts.incluirTipo !== false && params.tipo) { args.push(params.tipo); where.push(`tipo_fornecimento = $${args.length}`) }
  if (params.categoria) { args.push(params.categoria); where.push(`categoria_saude = $${args.length}`) }
  if (params.ano && /^\d{4}$/.test(params.ano)) { args.push(Number(params.ano)); where.push(`EXTRACT(YEAR FROM data_publicacao) = $${args.length}`) }
  if (params.status === 'aberto') where.push(abertoExpr('contratacoes'))
  else if (params.status === 'encerrado') where.push(`NOT ${abertoExpr('contratacoes')}`)
  // Busca livre: cada termo precisa aparecer em ALGUM campo (objeto/proponente/
  // município/CNPJ/PNCP/itens) — AND entre termos, OR entre campos. Mesmo
  // tolerante-a-plural de matchesTermo (src/lib/text.ts).
  if (params.q) {
    for (const termo of termosBusca(params.q)) {
      args.push(variantesTermo(termo))
      const p = args.length
      where.push(`(
        ${semAcento('objeto_compra')} LIKE ANY($${p})
        OR ${semAcento('razao_social_orgao')} LIKE ANY($${p})
        OR ${semAcento('municipio')} LIKE ANY($${p})
        OR cnpj_orgao ILIKE ANY($${p})
        OR numero_controle_pncp ILIKE ANY($${p})
        OR EXISTS (SELECT 1 FROM itens i WHERE i.numero_controle_pncp = contratacoes.numero_controle_pncp
                   AND ${semAcento('i.descricao')} LIKE ANY($${p}))
      )`)
    }
  }
  if (params.proponente) {
    args.push([`%${normalizeText(params.proponente)}%`])
    where.push(`${semAcento('razao_social_orgao')} LIKE ANY($${args.length})`)
  }
  if (params.convenio) {
    args.push(`%${params.convenio}%`)
    where.push(`numero_controle_pncp ILIKE $${args.length}`)
  }
  // Portfólio: mesma lógica do texto livre (objeto OU itens), com as agulhas dos
  // produtos ATIVOS da conta (resolvidas em src/lib/portfolio-servidor.ts).
  //
  // Sem nenhum produto ativo, o filtro fica IMPOSSÍVEL em vez de sumir: "só o que
  // casa com meu portfólio" quando o portfólio está vazio é o conjunto vazio, não a
  // base inteira. Se o filtro simplesmente não fosse aplicado, a tela mostraria
  // licitação de qualquer coisa como se casasse com o catálogo do cliente.
  if (params.portfolioVazio) where.push('FALSE')
  else if (params.portfolioNeedles?.length) {
    args.push(params.portfolioNeedles.slice(0, 100).map((n) => `%${n}%`))
    const p = args.length
    where.push(`(
      ${semAcento('objeto_compra')} LIKE ANY($${p})
      OR EXISTS (SELECT 1 FROM itens i WHERE i.numero_controle_pncp = contratacoes.numero_controle_pncp
                 AND ${semAcento('i.descricao')} LIKE ANY($${p}))
    )`)
  }
  if (params.minScore && params.minScore > 0) {
    args.push(params.minScore)
    where.push(`${scoreExprSql('contratacoes')} >= $${args.length}`)
  }
  return { whereSql: where.join(' AND '), args }
}

// Totais REAIS do filtro (não da página carregada) — para os KPIs refletirem todo
// o universo selecionado, não só as N linhas renderizadas.
export interface TotaisBanco {
  total: number; valorTotal: number; abertas: number; estados: number; universo: number
  /** Quantas do filtro têm valor informado — denominador honesto do ticket médio. */
  comValor: number
  /** Municípios distintos do filtro — universo real, não só os N carregados.
   *  Conta o PAR (uf, município): "Bom Jesus" existe em 8 estados e são 8 cidades. */
  municipios: number
}
async function totaisDoBanco(params: FiltroBanco): Promise<TotaisBanco> {
  const cacheKey = `opp:totais:${params.ufs?.join(',') ?? params.uf ?? ''}:${params.municipio ?? ''}:${params.tipo ?? ''}:${params.status ?? ''}:${params.ano ?? ''}:${params.categoria ?? ''}:${params.q ?? ''}:${params.proponente ?? ''}:${params.convenio ?? ''}:${(params.portfolioNeedles ?? []).join('|')}${params.portfolioVazio ? ':pv' : ''}:${params.minScore ?? ''}`
  const cached = getCached<TotaisBanco>(cacheKey)
  if (cached) return cached
  // O WHERE sai SEM o filtro de status; o status vira um FILTER. Assim `total` segue
  // respeitando o filtro (o cabeçalho diz "N no filtro") e ganhamos `universo`, o
  // mesmo recorte ignorando aberto/encerrado. Antes o KPI mostrava "Em aberto: 50.241
  // de 50.241 total" — numerador e denominador saíam do mesmo WHERE com status=aberto,
  // então a razão era 100% por construção e não informava nada.
  const { whereSql, args } = construirWhere({ ...params, status: 'todos' })
  const statusSql =
    params.status === 'aberto' ? abertoExpr('contratacoes')
    : params.status === 'encerrado' ? `NOT ${abertoExpr('contratacoes')}`
    : 'TRUE'
  const [row] = await query<TotaisBanco>(
    `SELECT count(*) FILTER (WHERE ${statusSql})::int AS total,
            COALESCE(sum(valor_total_estimado) FILTER (WHERE ${statusSql}), 0)::float8 AS "valorTotal",
            count(*) FILTER (WHERE ${abertoExpr('contratacoes')})::int AS abertas,
            count(DISTINCT uf) FILTER (WHERE ${statusSql})::int AS estados,
            -- O PAR (uf, município), não o nome sozinho: há 8 "Bom Jesus", 5 "Bonito"
            -- e 4 "Santa Maria" em UFs diferentes, e contar por nome funde as cidades
            -- num município só. Mesma normalização do filtro por cidade
            -- (UPPER(TRIM(...)) em construirWhere), para "São Paulo " e "SÃO PAULO"
            -- não virarem duas. Linha sem uf/município não conta como cidade.
            count(DISTINCT (uf, UPPER(TRIM(municipio)))) FILTER (
              WHERE ${statusSql} AND uf IS NOT NULL AND municipio IS NOT NULL
            )::int AS municipios,
            count(*)::int AS universo,
            count(*) FILTER (WHERE ${statusSql} AND valor_total_estimado IS NOT NULL)::int AS "comValor"
       FROM contratacoes WHERE ${whereSql}`,
    args,
  )
  return setCached(cacheKey, row ?? { total: 0, valorTotal: 0, abertas: 0, estados: 0, municipios: 0, universo: 0, comValor: 0 }, TTL.SHORT)
}

// Contagem por tipo de fornecimento (para as abas), SEM o filtro de tipo — assim
// todas as abas mostram seu total dentro do filtro de status/ano/categoria.
async function porTipoDoBanco(params: FiltroBanco): Promise<Record<string, number>> {
  const cacheKey = `opp:portipo:${params.ufs?.join(',') ?? params.uf ?? ''}:${params.municipio ?? ''}:${params.status ?? ''}:${params.ano ?? ''}:${params.categoria ?? ''}:${params.q ?? ''}:${params.proponente ?? ''}:${params.convenio ?? ''}:${(params.portfolioNeedles ?? []).join('|')}${params.portfolioVazio ? ':pv' : ''}:${params.minScore ?? ''}`
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

// Colunas ordenáveis por ThSort (src/components/ui/ThSort.tsx) — whitelist: nunca
// interpolar o `sort` do usuário direto no SQL.
const SORT_COLUMNS: Record<string, string> = {
  valor: 'valor_total_estimado',
  ano: 'data_publicacao',
  proponente: 'razao_social_orgao',
  item: 'objeto_compra',
  status: abertoExpr('contratacoes'),
  score: scoreExprSql('contratacoes'),
}

// Ordenação canônica da listagem — SEMPRE terminada por um desempate ÚNICO.
//
// POR QUE O DESEMPATE: com LIMIT/OFFSET, ordenar só pela coluna pedida não é
// determinístico. status é booleano, score assume poucos valores discretos, ano e
// valor repetem à vontade — dentro de um empate o Postgres pode devolver as linhas
// em ordem diferente entre dois requests (plano paralelo, ordem física, cache), e aí
// a mesma licitação aparece na página 2 e na 3 enquanto outra não aparece em nenhuma.
// `numero_controle_pncp` é a PK: acrescentado no fim, toda ordenação passa a ser
// total, e a paginação para de embaralhar.
//
// Uma função só (em vez de montar o ORDER BY em cada lugar) porque o localizarId
// (deep-link ?opp=) precisa da MESMA ordem da listagem: se as duas divergirem, o
// link leva o usuário para a página errada — o item não está onde ele foi mandado.
function ordemSql(sort: string | undefined, dir: 'asc' | 'desc'): string {
  const col = sort ? SORT_COLUMNS[sort] : undefined
  const d = dir === 'asc' ? 'ASC' : 'DESC'
  return col
    ? `${col} ${d} NULLS LAST, numero_controle_pncp ASC`
    : `${scoreExprSql('contratacoes')} DESC, data_publicacao DESC NULLS LAST, numero_controle_pncp ASC`
}

// Fonte primária: banco. Uma consulta que não casou nada devolve [] — resposta
// VÁLIDA, não sinal de fallback. Banco indisponível LANÇA (quem chama trata), e é
// só isso que autoriza cair para o PNCP ao vivo: ver o bloco de decisão no GET.
async function buscarDoBanco(params: {
  uf?: string
  ufs?: string[]
  municipio?: string
  tipo?: TipoFornecimento
  porUf?: number // amostra por UF (mapa): top-N por UF, cobertura geográfica
  status?: 'aberto' | 'encerrado' | 'todos'
  ano?: string
  categoria?: string
  q?: string
  proponente?: string
  convenio?: string
  portfolioNeedles?: string[]
  portfolioVazio?: boolean
  minScore?: number
  limit?: number
  offset?: number
  sort?: string
  dir?: 'asc' | 'desc'
  agora: string
}): Promise<Oportunidade[]> {
  const cacheKey = `opp:banco:${params.ufs?.length ? params.ufs.join(',') : params.uf ?? ''}:${params.municipio ?? ''}:${params.tipo ?? ''}:${params.porUf ?? ''}:${params.status ?? ''}:${params.ano ?? ''}:${params.categoria ?? ''}:${params.q ?? ''}:${params.proponente ?? ''}:${params.convenio ?? ''}:${(params.portfolioNeedles ?? []).join('|')}${params.portfolioVazio ? ':pv' : ''}:${params.minScore ?? ''}:${params.limit ?? ''}:${params.offset ?? ''}:${params.sort ?? ''}:${params.dir ?? ''}`
  const cached = getCached<Oportunidade[]>(cacheKey)
  if (cached) return cached

  const { whereSql, args } = construirWhere(params)

  const cols = `numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
            modalidade_nome, objeto_compra, ano_compra, sequencial_compra,
            valor_total_estimado::float8 AS valor_total_estimado,
            to_char(data_publicacao, 'YYYY-MM-DD') AS data_publicacao,
            situacao_id, categoria_saude, tipo_fornecimento, fonte, link_externo,
            usuario_nome`
  const lim = Math.min(Math.max(Math.floor(params.limit ?? 4000), 1), 4000)
  const off = Math.max(0, Math.floor(params.offset ?? 0))
  // Sem coluna válida: mesmo default de sempre (score desc, data, e a PK no fim).
  const orderBySql = `ORDER BY ${ordemSql(params.sort, params.dir ?? 'desc')}`

  // Modo mapa: top-N por UF (janela) → toda UF com dado aparece, sem viés de recência.
  // Caso contrário: paginado, ordenado pela coluna pedida (ou o default de relevância).
  const sql = params.porUf
    ? `SELECT ${cols}, aberto FROM (
         SELECT *, ${abertoExpr('contratacoes')} AS aberto,
                ROW_NUMBER() OVER (PARTITION BY uf ORDER BY valor_total_estimado DESC NULLS LAST, numero_controle_pncp ASC) AS rn
         FROM contratacoes WHERE ${whereSql}
       ) c WHERE rn <= ${Math.min(Math.max(Math.floor(params.porUf), 1), 100)}`
    : `SELECT ${cols}, ${abertoExpr('contratacoes')} AS aberto FROM contratacoes WHERE ${whereSql} ${orderBySql} LIMIT ${lim} OFFSET ${off}`

  const rows = await query<ContratacaoRow>(sql, args)

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
      // Segue cru para a UI: `link` acima já virou a URL canônica do PNCP quando
      // não havia link próprio, então ele não distingue mais "sem portal" de
      // "portal é o PNCP". `usuario_nome` distingue, e é o que resolve o portal
      // dos registros sem link.
      usuarioNome: r.usuario_nome,
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
    const offset = Math.max(0, Number(searchParams.get('offset') ?? 0) || 0)
    const q = searchParams.get('q')?.trim() || undefined
    const proponente = searchParams.get('proponente')?.trim() || undefined
    const convenio = searchParams.get('convenio')?.trim() || undefined
    // Filtro "Meu Portfólio": INTERRUPTOR, não conteúdo. As palavras-chave (nomes,
    // marcas e modelos do que o cliente vende) são resolvidas no servidor a partir
    // da conta — ver src/lib/portfolio-servidor.ts para o porquê de não virem na URL.
    // Ligado sem portfólio na conta = filtro que não casa nada (NÃO "sem filtro"):
    // devolver a base inteira aqui mostraria justamente o ruído que o filtro existe
    // para eliminar. O aviso diz ao usuário o que aconteceu.
    const portfolioLigado = !!(searchParams.get('portfolio')?.trim())
    let portfolioNeedles: string[] | undefined
    const avisosPortfolio: string[] = []
    if (portfolioLigado) {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
      const uid = ((token?.id as string | undefined) ?? token?.sub)?.toLowerCase()
      try {
        portfolioNeedles = uid ? await needlesDoPortfolio(uid) : []
      } catch (err) {
        // Banco fora: sem ele não há como saber o que o cliente vende. O fallback
        // do PNCP ao vivo NÃO serve aqui — ele não sabe filtrar por portfólio, e
        // devolver a base inteira num filtro de portfólio é justamente o que não
        // se pode fazer. Melhor dizer que o filtro está indisponível.
        console.warn('[opportunities] portfólio indisponível (banco):', String(err))
        return NextResponse.json(
          { error: 'Filtro "Meu Portfólio" indisponível agora (banco de dados fora do ar). Desligue o filtro para ver as licitações.' },
          { status: 503 },
        )
      }
      if (!portfolioNeedles.length) {
        avisosPortfolio.push('Meu Portfólio: nenhum produto ativo encontrado na sua conta — cadastre produtos no Setup da Empresa (/perfil).')
      }
    }
    // Filtro pedido e nenhuma agulha: o WHERE tem que ficar IMPOSSÍVEL, não
    // desaparecer (ver construirWhere) — senão o filtro vira "sem filtro".
    const portfolioVazio = portfolioLigado && !portfolioNeedles?.length
    const sortParam = searchParams.get('sort')?.trim() || undefined
    const dirParam: 'asc' | 'desc' = searchParams.get('dir') === 'asc' ? 'asc' : 'desc'
    const agora = new Date().toISOString()

    // Deep-link (?opp=): localiza em qual página (do filtro/ordenação atuais) o item
    // cai, sem carregar o universo inteiro no client para procurar o índice.
    const localizarId = searchParams.get('localizarId')?.trim() || undefined
    if (localizarId) {
      const idAlvo = localizarId.startsWith('pncp-') ? localizarId.slice(5) : localizarId
      const { whereSql, args } = construirWhere({ uf, ufs, municipio, tipo, status, ano, categoria, q, proponente, convenio, portfolioNeedles, portfolioVazio, minScore })
      args.push(idAlvo)
      try {
        const [row] = await query<{ posicao: number }>(
          `SELECT posicao FROM (
             SELECT numero_controle_pncp, ROW_NUMBER() OVER (ORDER BY ${ordemSql(sortParam, dirParam)}) - 1 AS posicao
             FROM contratacoes WHERE ${whereSql}
           ) t WHERE numero_controle_pncp = $${args.length}`,
          args,
        )
        const paginaAlvo = row ? Math.floor(row.posicao / Math.max(1, limit)) + 1 : null
        return NextResponse.json({ pagina: paginaAlvo })
      } catch (error) {
        console.error('[opportunities:localizar]', error)
        return NextResponse.json({ pagina: null })
      }
    }

    // 1) Banco (primário). 2) PNCP ao vivo (fallback) se o banco vier vazio/indisponível.
    let oportunidades: Oportunidade[] = []
    let fonte = 'Banco GovHealth (ETL PNCP)'
    let avisos: string[] = []
    let serieMensal: SerieMensalRow[] = []
    let porCategoria: PorCategoriaRow[] = []
    // Totais REAIS do filtro (todo o universo, não só as N linhas carregadas).
    let totais: TotaisBanco | null = null
    let porTipo: Record<string, number> | null = null
    // true quando a listagem veio do banco (já ordenada/paginada em SQL) — o re-sort
    // em JS mais abaixo só deve rodar no fallback PNCP (que não ordena/pagina em SQL).
    let viaBanco = false
    // true quando a conexão com o banco falhou (não só "sem linhas") — usado pra NÃO
    // tentar de novo mais abaixo (CAPAG). Sem isto, uma queda de conexão pagava o
    // timeout (connectionTimeoutMillis) duas vezes na mesma requisição: uma aqui,
    // outra no enriquecimento de CAPAG — dobrando a espera à toa por algo que já
    // sabíamos que ia falhar de novo.
    let bancoIndisponivel = false

    // Um filtro está ATIVO? Decide o que fazer com "zero linhas" logo abaixo.
    const comFiltro = !!(uf || ufs?.length || municipio || tipo || status || ano || categoria
      || q || proponente || convenio || portfolioLigado || minScore > 0 || offset > 0)

    try {
      const [doBanco, tot, pt] = await Promise.all([
        buscarDoBanco({ uf, ufs, municipio, tipo, porUf, status, ano, categoria, q, proponente, convenio, portfolioNeedles, portfolioVazio, minScore, limit, offset, sort: sortParam, dir: dirParam, agora }),
        porUf ? Promise.resolve(null) : totaisDoBanco({ uf, ufs, municipio, tipo, status, ano, categoria, q, proponente, convenio, portfolioNeedles, portfolioVazio, minScore }),
        porUf ? Promise.resolve(null) : porTipoDoBanco({ uf, ufs, municipio, status, ano, categoria, q, proponente, convenio, portfolioNeedles, portfolioVazio, minScore }),
      ])
      totais = tot
      porTipo = pt

      // ZERO LINHAS NÃO É FALHA DO BANCO. Busca sem correspondência, página além do
      // fim, portfólio que não casa nada — todos são respostas VÁLIDAS e a resposta
      // certa é a lista vazia. Antes qualquer um deles caía no PNCP ao vivo, que não
      // conhece q/proponente/convênio/portfólio/status/offset/ordenação: a tela
      // mostrava oportunidades ALHEIAS ao filtro enquanto os totais diziam zero.
      //
      // O fallback continua existindo para o que ele foi feito: banco sem NADA (ex.:
      // instalação nova, ETL ainda não rodou). Isso é reconhecível — nenhum filtro
      // ativo E o universo do recorte é zero — e não se confunde com "filtrei e não
      // achei". Banco fora do ar cai no catch, abaixo.
      const baseVazia = !comFiltro && (tot ? tot.universo === 0 : doBanco.length === 0)
      if (baseVazia) {
        const pncp = await buscarDoPNCP({ uf, agora })
        oportunidades = tipo ? pncp.ops.filter((o) => o.tipoFornecimento === tipo) : pncp.ops
        fonte = 'PNCP (tempo real)'
        avisos = pncp.erros
      } else {
        oportunidades = doBanco
        viaBanco = true
        const agg = await agregadosDoBanco({ uf, ufs, tipo }) // gráficos sobre o dataset completo
        serieMensal = agg.serieMensal
        porCategoria = agg.porCategoria
      }
    } catch (dbErr) {
      // Banco indisponível (ex.: DATABASE_URL ausente, timeout de conexão) → cai
      // para o PNCP ao vivo.
      console.warn('[opportunities] banco indisponível, usando PNCP ao vivo:', String(dbErr))
      bancoIndisponivel = true
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
    // fiscal do órgão pagador. Índice carregado em lote (cacheado) para as UFs
    // presentes. Pulado quando o banco já falhou acima — tentar de novo aqui só
    // pagaria o mesmo timeout de conexão uma segunda vez, sem chance de dar certo.
    if (!bancoIndisponivel) {
      try {
        const ufsPresentes = [...new Set(oportunidades.map((o) => o.uf).filter((u) => u && u !== 'N/D'))]
        const capagIdx = await carregarIndiceCapag(ufsPresentes.length ? ufsPresentes : undefined)
        oportunidades = oportunidades.map((o) => aplicarCapacidade(o, capagIdx))
      } catch (capErr) {
        console.warn('[opportunities] capacidade de pagamento indisponível:', String(capErr))
      }
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

    // Via banco: já veio ordenado/paginado em SQL (inclusive por sort=/dir= do
    // usuário) — reordenar aqui por score jogaria fora a ordenação pedida. Via PNCP
    // (fallback, sem SQL): mantém o comportamento de sempre.
    resultado = viaBanco
      ? resultado.slice(0, limit)
      : resultado
          .sort((a, b) => b.score - a.score || (b.licitacaoRelacionada?.dataPublicacaoPncp ?? '').localeCompare(a.licitacaoRelacionada?.dataPublicacaoPncp ?? ''))
          .slice(0, limit)

    // Totais do filtro: preferir o agregado do banco (universo completo). Sem ele
    // (PNCP/porUf), cai para os totais do conjunto carregado.
    const totaisFinal: TotaisBanco = totais ?? {
      total: resultado.length,
      valorTotal: resultado.reduce((s, o) => s + o.valorEstimado, 0),
      abertas: resultado.filter((o) => o.licitacaoRelacionada?.situacaoCompraId === 1).length,
      estados: new Set(resultado.map((o) => o.uf)).size,
      // Par UF+município, igual ao count(DISTINCT (uf, municipio)) do SQL — pelo nome
      // sozinho, os 8 "Bom Jesus" do país contavam como uma cidade só.
      municipios: new Set(resultado.map((o) => `${o.uf}|${o.municipio}`)).size,
      universo: resultado.length,
      comValor: resultado.filter((o) => o.valorEstimado > 0).length,
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
      avisos: [...avisosPortfolio, ...avisos],
      // Selo de proveniência: quando vem do banco, usa a data REAL da última coleta
      // do ETL (não a hora do request) — corrige o "atualizado agora" genérico.
      atualizadoEm: fonte.startsWith('Banco') ? ((await ultimaColetaResultados()) ?? agora) : agora,
    })
  } catch (error) {
    console.error('[opportunities]', error)
    return NextResponse.json({ error: 'Erro ao calcular oportunidades', detalhe: String(error) }, { status: 500 })
  }
}
