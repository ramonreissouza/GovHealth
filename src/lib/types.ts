// src/lib/types.ts

export interface Convenio {
  id: string
  numero: string
  objeto: string
  situacao: string
  valorTotal: number
  valorLiberado: number
  valorContrapartida: number
  dataInicio: string
  dataFim: string
  municipio: string
  uf: string
  orgaoConcedente: string
  convenente: string
  percentualExecutado: number
}

export interface Licitacao {
  id: string
  numeroControlePNCP: string
  orgaoEntidade: {
    cnpj: string
    razaoSocial: string
    municipio?: string
    uf?: string
  }
  modalidadeNome: string
  objetoCompra: string
  valorTotalEstimado: number
  dataPublicacaoPncp: string
  dataEncerramentoProposta?: string
  situacaoCompraId: number
  situacaoCompraNome: string
  linkSistemaOrigem: string
  itens?: ItemLicitacao[]
}

export interface ItemLicitacao {
  numeroItem: number
  descricao: string
  valorUnitarioEstimado: number
  quantidade: number
  unidadeMedida: string
}

export interface Oportunidade {
  id: string
  municipio: string
  uf: string
  regiao: string
  hospital?: string
  categoria: CategoriaEquipamento
  descricao: string
  score: number
  subScores: {
    convenio: number
    historico: number
    orgao: number
    competicao: number
    capacidade?: number // capacidade de pagamento (CAPAG/Serasa); ausente em fontes sem o dado
  }
  // Capacidade de pagamento da instituição (CAPAG p/ público, Serasa p/ privado).
  capacidadePagamento?: {
    fonte: 'capag' | 'serasa' | 'na'
    nota: 'A' | 'B' | 'C' | 'D' | null
    label: string
  }
  valorEstimado: number
  janelaEmDias: number
  urgencia: 'urgente' | 'alta' | 'media' | 'normal'
  status: 'quente' | 'morno' | 'frio'
  probabilidadeEdital: number
  concorrentes: string[]
  indiceConcorrencia: 'baixo' | 'medio' | 'alto'
  acaoRecomendada: string
  tipoFornecimento?: TipoFornecimento
  convenioRelacionado?: Convenio
  licitacaoRelacionada?: Licitacao
  cnesLeitos?: number
  cnesCategoriaHospital?: 'federal' | 'estadual' | 'municipal' | 'privado'
  lat?: number
  lng?: number
  createdAt: string
  updatedAt: string
}

export type CategoriaEquipamento =
  | 'imagem'
  | 'uti'
  | 'laboratorio'
  | 'cirurgia'
  | 'oncologia'
  | 'medicamento'
  | 'outros'

// Classificação por tipo de fornecimento (eixo de navegação por aba)
export type TipoFornecimento =
  | 'equipamento'   // equipamentos médicos
  | 'medicamento'   // medicamentos / insumos farmacêuticos
  | 'opme'          // órteses, próteses e materiais especiais
  | 'servico'       // serviços (manutenção, instalação, locação, esterilização…)
  | 'acessorio'     // acessórios / materiais de consumo / descartáveis
  | 'outros'

export interface Concorrente {
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string
  totalPregoes: number
  totalVitorias: number
  taxaVitoria: number
  valorTotalContratos: number
  regioesDominantes: string[]
  shareNacional: number
  precoMedioVencedor: number
  ultimaParticipacao: string
}

export interface Alert {
  id: string
  tipo: 'edital' | 'concorrente' | 'emenda' | 'vencimento' | 'oportunidade'
  titulo: string
  descricao: string
  oportunidadeId?: string
  score?: number
  urgencia: 'alta' | 'media' | 'normal'
  createdAt: string
  lida: boolean
  href?: string // destino ao clicar no alerta (drill-down)
  uf?: string   // estado, para o filtro por UF e o match por monitor
}

export interface DashboardKPIs {
  oportunidadesQuentes: number
  valorTotalEstimado: number
  editaisPrevisos60d: number
  municipiosMonitorados: number
  alertasNovos: number
  scoreMedio: number
}

export interface ForecastMensal {
  mes: string
  editaisPrevistos: number
  valorEstimado: number
  categorias: Record<CategoriaEquipamento, number>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: string[]
}

// --- Compras.gov types ---

export interface PrecoPainelItem {
  id: string
  codigoItem: string
  descricaoItem: string
  unidadeMedida: string
  valorUnitario: number
  quantidade: number
  valorTotal: number
  dataResultado: string
  nomeOrgao: string
  siglaUf: string
  municipio?: string
  cnpjFornecedor: string
  razaoSocialFornecedor: string
  numeroDocumento?: string
  origem: 'contrato' | 'ata'
  // Campos enriquecidos da Pesquisa de Preço (era PNCP / Lei 14.133)
  marca?: string
  esfera?: string          // Federal | Estadual | Municipal | Distrital
  poder?: string           // Executivo | Legislativo | Judiciário
  modalidade?: number
  nomeClasse?: string
  objetoCompra?: string
  tipoCompra?: 'publica' | 'privada'
}

export interface CatmatMaterial {
  codigo: string
  descricao: string
  unidadeFornecimento: string
  status: string
  classe?: string
  pdm?: string
}

export interface EstatisticaPrecos {
  total: number
  valorMin: number
  valorMax: number
  valorMedio: number
  valorMediano: number
  fornecedoresUnicos: number
  orgaosUnicos: number
  // Unidades de fornecimento predominantes nos preços do Compras.gov (mais frequentes
  // primeiro). Serve para tornar VISÍVEL o descasamento de unidade vs. o edital
  // (ex.: "CX C/100" no Compras.gov × "UN" no edital) — principal causa de referência
  // aparentemente distante quando não há CATMAT para casar exatamente.
  unidades?: { sigla: string; n: number }[]
}

// --- CNES types ---

export interface CnesEstabelecimento {
  codigoEstabelecimento: string
  nomeFantasia: string
  razaoSocial: string
  cnpj: string
  codigoMunicipio: string
  municipio: string
  uf: string
  tipoGestao: 'federal' | 'estadual' | 'municipal' | 'dupla' | 'sem-gestao'
  leitos: number
  leitosSUS: number
  tipoUnidade: string
}

// --- Análise de Edital (Copiloto de Edital) ---

export interface PrazoEdital {
  rotulo: string         // ex.: "Sessão de disputa", "Limite p/ impugnação"
  data?: string          // texto/data como aparece no edital
  observacao?: string
}

export interface ClausulaRestritiva {
  trecho: string         // trecho do edital
  motivo: string         // por que pode ser restritivo/direcionado
  severidade: 'alta' | 'media' | 'baixa'
}

export interface PontoImpugnacao {
  ponto: string                        // a irregularidade/cláusula
  fundamento: string                   // violação legal (art. da Lei 14.133 etc.)
  relevancia: 'critico' | 'alto' | 'medio' | 'baixo'
  probabilidadeExito: 'alta' | 'media' | 'baixa'
}

export interface AnaliseEdital {
  resumo: string                       // 2-3 frases
  objeto: string
  orgao?: string
  modalidade?: string                  // pregão eletrônico, dispensa, concorrência…
  valorEstimado?: string               // como texto (pode vir "não informado")
  especificacoes: string[]             // specs técnicas exigidas
  habilitacao: string[]                // documentos de habilitação exigidos
  prazos: PrazoEdital[]
  penalidades: string[]
  clausulasRestritivas: ClausulaRestritiva[]  // possível direcionamento
  recomendacoes: string[]              // pontos de atenção p/ a proposta
  aderenciaPortfolio?: string          // análise de match c/ portfólio (se enviado)
  // Análise jurídica rigorosa (Lei 14.133/2021) — conformidade + impugnação + veredito.
  analiseLegal?: string[]              // ilegalidades/vícios/omissões com fundamento legal
  riscos?: { descricao: string; grau: 'alto' | 'medio' | 'baixo'; mitigacao?: string }[]
  impugnacao?: {
    recomendada: boolean               // vale a pena impugnar?
    tipo?: 'total' | 'parcial' | 'nao'
    estrategia?: string                // impugnação formal / pedido de esclarecimento / participar sem questionar
    pontos?: PontoImpugnacao[]
    minuta?: string                    // peça de impugnação pronta para protocolo (texto)
  }
  conclusao?: {
    participar: string                 // veredito: vale a pena participar? + justificativa
    principaisRiscos?: string[]
    principaisVantagens?: string[]
  }
}

// --- Contratos.gov.br (Comprasnet Contratos) ---

export interface ContratoGov {
  id: string
  numero: string
  objeto: string
  situacao: string
  receitaDespesa?: string
  fornecedorNome: string
  fornecedorCnpj: string
  orgaoNome: string
  ugNome: string
  ugCodigo: string
  modalidade: string
  vigenciaInicio: string   // ISO (YYYY-MM-DD)
  vigenciaFim: string      // ISO
  dataAssinatura: string
  valorInicial: number
  valorGlobal: number
  valorAcumulado: number
  linkHistorico?: string
}

// --- DOU types ---

export interface DouAviso {
  id: string
  data: string
  secao: string
  numero: string
  titulo: string
  resumo: string
  tipoPublicacao: string
  orgao?: string
  urlTexto?: string
  municipio?: string
  uf?: string
  valorEstimado?: number
}

// --- API Response types ---

export interface PNCPContratacoesResponse {
  data: PNCPContratacao[]
  totalRegistros: number
  totalPaginas: number
  paginaAtual: number
  tamanhoPagina: number
}

export interface PNCPContratacao {
  numeroControlePNCP: string
  orgaoEntidade: {
    cnpj: string
    razaoSocial: string
    poderId: string
    esferaId: string
    municipioNome?: string
    ufSigla?: string
    ufNome?: string
  }
  unidadeOrgao: {
    codigoUnidade: string
    nomeUnidade: string
    municipioNome?: string
    ufSigla?: string
    codigoIbge?: string
  }
  modalidadeId: number
  modalidadeNome: string
  modoDisputaId: number
  modoDisputaNome: string
  tipoInstrumentoConvocatorioId?: number
  tipoInstrumentoConvocatorioNome?: string
  objetoCompra: string
  informacaoComplementar?: string
  srp: boolean
  dataPublicacaoPncp: string
  dataAberturaProposta?: string
  dataEncerramentoProposta?: string
  valorTotalEstimado?: number
  valorTotalHomologado?: number
  situacaoCompraId: number
  situacaoCompraNome: string
  linkSistemaOrigem: string
  sequencialCompra: number
  anoCompra: number
  processo?: string
  codigoUnidadeCompradora?: string
}

export interface TranspGovConvenio {
  id: number
  dataInicioVigencia: string
  dataFinalVigencia: string
  dataPublicacao?: string
  dimConvenio: {
    codigo: string
    objeto: string
    numero: string
  }
  situacao: string
  convenente?: {
    cnpjFormatado?: string
    nome?: string
  }
  municipioConvenente?: {
    nomeIBGE?: string
    uf?: {
      sigla?: string  // nome completo do estado
      nome?: string   // sigla UF (ex: "SP")
    }
  }
  orgao?: {
    nome?: string
    sigla?: string
  }
  valor: number
  valorLiberado: number
  valorContrapartida: number
}
