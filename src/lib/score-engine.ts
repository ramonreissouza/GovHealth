// src/lib/score-engine.ts
// Opportunity Score Engine — calcula probabilidade de abertura de edital
// Modelo: ensemble de regras ponderadas + heurísticas baseadas em padrões históricos
// V1: rule-based (MVP) | V2: XGBoost treinado com dados históricos

import { Convenio, Oportunidade, CategoriaEquipamento, TipoFornecimento } from './types'
import { stripAccents, normalizeKey } from './text'
import { diasAteVencimento } from './transferegov'
import { isSaudeRelated } from './pncp'

// Pesos dos sub-scores (somam 1.0)
const PESOS = {
  convenio: 0.30,
  historico: 0.28,
  orgao: 0.22,
  competicao: 0.20,
}

// Ciclos médios de compra por categoria (em meses)
const CICLO_MEDIO: Record<CategoriaEquipamento, number> = {
  imagem: 60,
  uti: 48,
  laboratorio: 36,
  cirurgia: 72,
  oncologia: 48,
  medicamento: 12, // medicamentos são compra recorrente (ciclo curto)
  outros: 54,
}

export interface ScoreInput {
  convenio: Convenio
  idadeEquipamentoAnos?: number
  ultimaCompraAnos?: number
  temEmendaParlamentar?: boolean
  categoriaEquipamento: CategoriaEquipamento
  nConcorrentes?: number
  shareLiderRegional?: number
  concorrentePerdeuUltimoPregao?: boolean
  leitos?: number
  categoriaHospital?: 'federal' | 'estadual' | 'municipal' | 'privado'
}

export interface ScoreResult {
  score: number // 0-100
  subScores: {
    convenio: number
    historico: number
    orgao: number
    competicao: number
  }
  probabilidadeEdital: number // 0-1
  janelaEmDias: number
  urgencia: 'urgente' | 'alta' | 'media' | 'normal'
  status: 'quente' | 'morno' | 'frio'
  indiceConcorrencia: 'baixo' | 'medio' | 'alto'
  acaoRecomendada: string
  explicacao: string[]
}

/**
 * Calcula o Opportunity Score para uma oportunidade
 */
export function calcularScore(input: ScoreInput): ScoreResult {
  const s1 = calcularSubScoreConvenio(input)
  const s2 = calcularSubScoreHistorico(input)
  const s3 = calcularSubScoreOrgao(input)
  const s4 = calcularSubScoreCompeticao(input)

  const score = Math.round(
    s1 * PESOS.convenio +
    s2 * PESOS.historico +
    s3 * PESOS.orgao +
    s4 * PESOS.competicao
  )

  const probabilidadeEdital = score / 100
  const janelaEmDias = calcularJanela(input, score)
  const urgencia = calcularUrgencia(janelaEmDias, score)
  const indiceConcorrencia = calcularIndiceConcorrencia(input)
  const acaoRecomendada = gerarAcao(score, urgencia, indiceConcorrencia)
  const explicacao = gerarExplicacao(input, { s1, s2, s3, s4 })

  return {
    score,
    subScores: { convenio: s1, historico: s2, orgao: s3, competicao: s4 },
    probabilidadeEdital,
    janelaEmDias,
    urgencia,
    status: score >= 75 ? 'quente' : score >= 50 ? 'morno' : 'frio',
    indiceConcorrencia,
    acaoRecomendada,
    explicacao,
  }
}

// --- Sub-score calculators ---

function calcularSubScoreConvenio(input: ScoreInput): number {
  let score = 0
  const { convenio } = input
  const dias = diasAteVencimento(convenio.dataFim)

  // Percentual executado: quanto mais executado, mais próxima a licitação
  if (convenio.percentualExecutado >= 80) score += 40
  else if (convenio.percentualExecutado >= 60) score += 30
  else if (convenio.percentualExecutado >= 40) score += 20
  else if (convenio.percentualExecutado >= 20) score += 10

  // Valor do convênio (verbas maiores geram oportunidades maiores)
  if (convenio.valorTotal >= 5_000_000) score += 25
  else if (convenio.valorTotal >= 2_000_000) score += 20
  else if (convenio.valorTotal >= 500_000) score += 12
  else score += 5

  // Proximidade do vencimento (pressão para executar)
  if (dias > 0 && dias <= 60) score += 25
  else if (dias > 0 && dias <= 120) score += 18
  else if (dias > 0 && dias <= 180) score += 10
  else if (dias > 0 && dias <= 365) score += 5

  // Verba já liberada (dinheiro em conta)
  if (convenio.valorLiberado > 0) {
    const pctLiberado = convenio.valorLiberado / convenio.valorTotal
    if (pctLiberado >= 0.8) score += 10
    else if (pctLiberado >= 0.5) score += 7
    else score += 3
  }

  return clamp(score, 0, 100)
}

function calcularSubScoreHistorico(input: ScoreInput): number {
  let score = 0
  const cicloMedio = CICLO_MEDIO[input.categoriaEquipamento]

  // Idade do equipamento atual
  if (input.idadeEquipamentoAnos !== undefined) {
    if (input.idadeEquipamentoAnos >= cicloMedio / 12) score += 40
    else if (input.idadeEquipamentoAnos >= (cicloMedio / 12) * 0.7) score += 25
    else if (input.idadeEquipamentoAnos >= (cicloMedio / 12) * 0.5) score += 12
    else score += 3
  } else {
    // Sem histórico: pontuação neutra
    score += 20
  }

  // Última compra registrada
  if (input.ultimaCompraAnos !== undefined) {
    const anosDesdeCompra = input.ultimaCompraAnos
    const cicloEmAnos = cicloMedio / 12
    if (anosDesdeCompra >= cicloEmAnos) score += 40
    else if (anosDesdeCompra >= cicloEmAnos * 0.75) score += 25
    else if (anosDesdeCompra >= cicloEmAnos * 0.5) score += 15
    else score += 5
  } else {
    score += 20
  }

  // Sazonalidade: Q2 e Q3 têm mais licitações de saúde
  const mes = new Date().getMonth() + 1
  if ([4, 5, 6, 7, 8].includes(mes)) score += 10
  else if ([3, 9, 10].includes(mes)) score += 6
  else score += 3

  return clamp(score, 0, 100)
}

function calcularSubScoreOrgao(input: ScoreInput): number {
  let score = 30 // base

  // Emenda parlamentar aprovada — sinal fortíssimo
  if (input.temEmendaParlamentar) score += 50

  // Tamanho do hospital (proxy por leitos)
  if (input.leitos) {
    if (input.leitos >= 500) score += 15
    else if (input.leitos >= 200) score += 10
    else if (input.leitos >= 100) score += 7
    else score += 3
  }

  // Tipo de gestão
  if (input.categoriaHospital === 'federal') score += 5
  else if (input.categoriaHospital === 'estadual') score += 4
  else if (input.categoriaHospital === 'municipal') score += 3

  return clamp(score, 0, 100)
}

function calcularSubScoreCompeticao(input: ScoreInput): number {
  let score = 20 // base

  // Concorrente líder perdeu último pregão → mercado aberto
  if (input.concorrentePerdeuUltimoPregao) score += 40

  // Share do líder regional (alto share = difícil entrar)
  if (input.shareLiderRegional !== undefined) {
    if (input.shareLiderRegional < 30) score += 30   // baixa concentração → boa oportunidade
    else if (input.shareLiderRegional < 50) score += 20
    else if (input.shareLiderRegional < 70) score += 10
    else score += 3 // dominado
  } else {
    score += 15
  }

  // Número de concorrentes históricos
  if (input.nConcorrentes !== undefined) {
    if (input.nConcorrentes <= 2) score += 10  // pouca competição
    else if (input.nConcorrentes <= 4) score += 6
    else score += 2 // muito disputado
  }

  return clamp(score, 0, 100)
}

// --- Helpers ---

function calcularJanela(input: ScoreInput, score: number): number {
  const dias = diasAteVencimento(input.convenio.dataFim)
  // Score alto + vencimento próximo = janela mais curta
  if (score >= 80 && dias <= 90) return 30
  if (score >= 70 && dias <= 180) return 60
  if (score >= 60) return 90
  if (score >= 50) return 120
  return 180
}

function calcularUrgencia(
  janela: number,
  score: number
): 'urgente' | 'alta' | 'media' | 'normal' {
  if (janela <= 30 && score >= 70) return 'urgente'
  if (janela <= 60 || score >= 80) return 'alta'
  if (janela <= 90 || score >= 65) return 'media'
  return 'normal'
}

function calcularIndiceConcorrencia(
  input: ScoreInput
): 'baixo' | 'medio' | 'alto' {
  const n = input.nConcorrentes ?? 3
  const share = input.shareLiderRegional ?? 50
  if (n <= 2 && share < 40) return 'baixo'
  if (n <= 4 && share < 65) return 'medio'
  return 'alto'
}

function gerarAcao(
  score: number,
  urgencia: string,
  concorrencia: string
): string {
  if (score >= 80) return 'Prioridade máxima — acionar equipe comercial agora'
  if (score >= 70 && urgencia === 'alta') return 'Incluir no pipeline — visita técnica recomendada'
  if (score >= 60 && concorrencia === 'baixo') return 'Oportunidade de baixa concorrência — monitorar de perto'
  if (score >= 50) return 'Incluir no funil de monitoramento ativo'
  return 'Monitorar — aguardar maturação do convênio'
}

function gerarExplicacao(
  input: ScoreInput,
  scores: { s1: number; s2: number; s3: number; s4: number }
): string[] {
  const ex: string[] = []

  if (input.convenio.percentualExecutado >= 70)
    ex.push(`${input.convenio.percentualExecutado}% da verba já executada — pressão para licitação iminente`)

  if (input.temEmendaParlamentar)
    ex.push('Emenda parlamentar aprovada — sinal fortíssimo de compra próxima')

  if (input.concorrentePerdeuUltimoPregao)
    ex.push('Concorrente líder perdeu último pregão — janela de entrada aberta')

  if (input.idadeEquipamentoAnos && input.idadeEquipamentoAnos >= CICLO_MEDIO[input.categoriaEquipamento] / 12)
    ex.push(`Equipamento com ${input.idadeEquipamentoAnos} anos — acima do ciclo médio de ${Math.round(CICLO_MEDIO[input.categoriaEquipamento] / 12)} anos`)

  const dias = diasAteVencimento(input.convenio.dataFim)
  if (dias > 0 && dias <= 90)
    ex.push(`Convênio vence em ${dias} dias — alta urgência de execução`)

  return ex
}

/**
 * Gera oportunidades a partir de convênios ativos
 * Combina dados do TransfereGov com score engine
 */
export function gerarOportunidadesDeConvenios(
  convenios: Convenio[],
  contexto: Partial<ScoreInput> = {},
  municipiosComEmendas: Set<string> = new Set()
): Oportunidade[] {
  return convenios
    .filter((c) => c.percentualExecutado >= 30 && c.valorTotal > 100_000)
    .map((convenio) => {
      const categoria = inferirCategoria(convenio.objeto)
      const input: ScoreInput = {
        convenio,
        categoriaEquipamento: categoria,
        ...contexto,
        temEmendaParlamentar:
          contexto.temEmendaParlamentar ||
          (municipiosComEmendas.size > 0 &&
            municipiosComEmendas.has(normalizarMunicipio(convenio.municipio))),
      }

      const resultado = calcularScore(input)

      const id = `opp-${convenio.id}-${Date.now()}`
      const agora = new Date().toISOString()

      return {
        id,
        municipio: convenio.municipio,
        uf: convenio.uf,
        regiao: inferirRegiao(convenio.uf),
        descricao: convenio.objeto,
        categoria,
        score: resultado.score,
        subScores: resultado.subScores,
        valorEstimado: Math.round(convenio.valorTotal * 0.6), // estimativa
        janelaEmDias: resultado.janelaEmDias,
        urgencia: resultado.urgencia,
        status: resultado.status,
        probabilidadeEdital: resultado.probabilidadeEdital,
        concorrentes: [],
        indiceConcorrencia: resultado.indiceConcorrencia,
        acaoRecomendada: resultado.acaoRecomendada,
        tipoFornecimento: classificarTipo(convenio.objeto),
        convenioRelacionado: convenio,
        createdAt: agora,
        updatedAt: agora,
      } satisfies Oportunidade
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Classifica a licitação por TIPO DE FORNECIMENTO (eixo de navegação por aba).
 * Ordem importa: serviço primeiro (ex.: "manutenção de tomógrafo" é serviço),
 * depois OPME, medicamento, equipamento e acessório.
 */
export function classificarTipo(objeto: string): TipoFornecimento {
  // Normaliza (remove acentos) — dados do governo vêm com/sem acento de forma inconsistente.
  const l = stripAccents(objeto).toLowerCase()

  // Serviços — manutenção, instalação, locação, esterilização, ambulância (serviço), etc.
  if (/manuten[çc]|reparo|conserto|instala[çc]|reforma|locaç|aluguel|loca[çc][ãa]o|presta[çc][ãa]o de servi|servi[çc]os? de|m[ãa]o de obra|limpeza|higieniza|esteriliza[çc]|lavanderia|dedetiza|coleta.*res[íi]duo|res[íi]duo.*sa[úu]de|transporte de pacient|remo[çc][ãa]o de pacient|servi[çc]o.*ambul[âa]nc|manuten[çc].*ambul[âa]nc|calibra[çc]|gases medicinais|oxig[êe]nio medicinal/.test(l)) return 'servico'

  // OPME — órteses, próteses e materiais especiais
  if (/[óo]rtese|pr[óo]tese|opme|implante|stent|marca-?passo|osteoss[íi]ntese|haste (femoral|intramedular)|placa (de )?titanio|parafuso (ortop|pedicular)|lente intraocular|prótese|enxerto [óo]sseo|fio de kirschner/.test(l)) return 'opme'

  // Medicamentos / insumos farmacêuticos
  if (/medicament|f[áa]rmaco|farmac[êe]ut|antibi[óo]tic|insumo farmac|princ[íi]pio ativo|vacina|soro fisiol|injet[áa]vel|comprimido|ampola|quimioter[áa]pico/.test(l)) return 'medicamento'

  // Equipamentos médicos
  if (/tom[óo]grafo|resson[âa]ncia|ultrassom|ultrassonograf|raio.?x|mam[óo]grafo|ventilador|respirador|monitor (multi|card|de )|desfibrilador|eletrocardi[óo]grafo|ox[íi]metro|autoclave|equipamento m[ée]dic|equipamento hospitalar|equipamento odontol|mesa cir[úu]rg|foco cir[úu]rg|maca|cama hospitalar|incubadora|bomba de infus|aparelho de|cadeira odontol/.test(l)) return 'equipamento'

  // Acessórios / materiais de consumo / descartáveis
  if (/acess[óo]rio|insumo|descart[áa]vel|seringa|agulha|luva|gaze|atadura|cateter|sonda|equipo|eletrodo|m[áa]scara|avental|compressa|curativo|fralda|material m[ée]dic|material hospitalar|material de consumo|reagente|kit (para|de) (teste|diagn)/.test(l)) return 'acessorio'

  return 'outros'
}

export function inferirCategoria(objeto: string): CategoriaEquipamento {
  // input normalizado em ASCII → regexes em ASCII (sem acentos)
  const lower = stripAccents(objeto).toLowerCase()
  if (/tomografo|tomografia|ressonancia|ultrassom|raio.?x|mamografo|radiolog/.test(lower)) return 'imagem'
  if (/\buti\b|ventilador|respirador|monitor|desfibrilador|bomba de infusao|oximetro/.test(lower)) return 'uti'
  if (/laboratorio|analisador|hematolog|hemoterapia|bioquim/.test(lower)) return 'laboratorio'
  if (/cirurgia|mesa cirurg|bisturi|laparoscopia|endoscopia/.test(lower)) return 'cirurgia'
  if (/oncologia|quimioterapia|radioterapia|acelerador/.test(lower)) return 'oncologia'
  if (/medicament|farmaco|farmaceutic|antibiotic|insumo farmac|principio ativo|comprimido|ampola|injetavel|soro|vacina/.test(lower)) return 'medicamento'
  return 'outros'
}

export function inferirRegiao(uf: string): string {
  const regioes: Record<string, string> = {
    AC: 'norte', AM: 'norte', AP: 'norte', PA: 'norte', RO: 'norte', RR: 'norte', TO: 'norte',
    AL: 'nordeste', BA: 'nordeste', CE: 'nordeste', MA: 'nordeste', PB: 'nordeste',
    PE: 'nordeste', PI: 'nordeste', RN: 'nordeste', SE: 'nordeste',
    DF: 'centro-oeste', GO: 'centro-oeste', MS: 'centro-oeste', MT: 'centro-oeste',
    ES: 'sudeste', MG: 'sudeste', RJ: 'sudeste', SP: 'sudeste',
    PR: 'sul', RS: 'sul', SC: 'sul',
  }
  return regioes[uf] ?? 'outros'
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

function normalizarMunicipio(nome: string): string {
  return normalizeKey(nome)
}
