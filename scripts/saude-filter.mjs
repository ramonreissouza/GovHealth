// scripts/saude-filter.mjs — classificação de objetos de compra como "saúde".
//
// Filtro de PRECISÃO (não de recall): o objetivo é trazer SÓ o que é exclusivo da
// área da saúde. Estratégia em duas camadas:
//   1) EXCLUI: se o objeto cita contexto claramente não-saúde (eventos/shows,
//      combustível/veículos, obras/vias, alimentação/escolar, etc.) → descarta,
//      mesmo que contenha alguma palavra de saúde.
//   2) SAUDE: exige pelo menos um termo específico de saúde (sem substrings
//      largas como 'equip'/'uti'/'monitor'/'raio' que casavam com
//      "equipamento de som", "utilização", "monitoramento", "raio de ação").
//
// Compartilhado entre o ETL (coleta) e o script de limpeza, para a definição de
// "saúde" ser única e não divergir.

const EXCLUI = [
  // eventos / shows / cultura
  'show', 'banda', 'pagode', 'sertanej', 'forró', 'forro', 'baile', 'festa', 'festiv',
  'carnaval', 'réveillon', 'reveillon', 'micareta', 'trio elétrico', 'trio eletrico',
  'palco', 'sonoriz', 'iluminaç', 'som e luz', 'estrutura tubular', 'tenda', 'toldo',
  'arquibancada', 'evento', 'buffet', 'coffee', 'brinde', 'troféu', 'trofeu', 'medalha',
  'premiaç', 'locação de estrutura', 'locacao de estrutura', 'banda de música',
  'bilheteria', 'fogos de artif', 'pirotécn', 'pirotecn', 'atração artístic', 'artist',
  // combustível / veículos
  'combustív', 'combustiv', 'gasolina', 'óleo diesel', 'oleo diesel', 'etanol',
  'lubrificante', 'pneu', 'automotiv', 'veícul', 'veicul', 'frota',
  // obras / vias
  'pavimentaç', 'pavimentac', 'asfalt', 'terraplan', 'recapea', 'drenagem', 'obra de',
  'construção de', 'construcao de', 'reforma e ampliaç',
  // alimentação / escolar
  'merenda', 'transporte escolar', 'material escolar', 'uniforme escolar',
  'alimentação escolar', 'alimentacao escolar', 'gênero aliment', 'genero aliment',
  'cesta básica', 'cesta basica',
  // serviços diversos não-clínicos
  'limpeza urbana', 'coleta de lixo', 'capina', 'roçagem', 'rocagem', 'publicidade',
  'assessoria de imprensa',
]

const SAUDE = [
  'saúde', 'saude', 'hospital', 'médic', 'medic', 'farmác', 'farmac', 'enfermag',
  'enfermeir', 'cirúrg', 'cirurg', 'odontológ', 'odontolog', 'ambulânci', 'ambulanci',
  'tomógraf', 'tomograf', 'ressonânci', 'ressonanci', 'ultrassom', 'ultrassonograf',
  'mamógraf', 'mamograf', 'radiológic', 'radiolog', 'laboratóri', 'laboratori',
  'laboratorial', 'hemodiál', 'hemodial', 'análises clínic', 'analises clinic',
  'oncológ', 'oncolog', 'quimioter', 'radioter', 'prótese', 'protese', 'órtese', 'ortese',
  'cateter', 'seringa', 'reagente', 'ventilador pulmonar', 'respirador', 'desfibrilador',
  'oxímetro', 'oximetr', 'vacina', 'imunobiol', 'soro fisiológic', 'fisioterap',
  'fonoaudiolog', 'psicológic', 'psiquiátric', 'esfigmoman', 'estetoscópio', 'estetoscopio',
  'gaze', 'atadura', 'samu', 'upa 24h', 'unidade de pronto atendimento', 'posto de saúde',
  'unidade básica', 'unidade basica', 'prontuário eletrôni', 'leito de uti', 'leito hospitalar',
  'equipamento médic', 'equipamento hospitalar', 'equipamento odontológic', 'equipamento laboratori',
  'material médic', 'material hospitalar', 'material odontológic', 'material penso',
  'insumo hospitalar', 'insumo médic', 'medicament', 'medicinal', 'monitor multiparâm',
  'monitor cardíac', 'raio-x', 'raio x', 'raios x', 'luva de procedimento', 'luva cirúrg',
  'vigilância sanitár', 'vigilância epidemiológic', 'atenção básica', 'atencao basica',
  'centro de saúde', 'farmácia básica',
  // termos adicionais de saúde (evitam falsos-negativos)
  'diális', 'dialis', 'curativo', 'fralda', 'ortopéd', 'ortoped', 'protétic', 'nebuliz',
  'glicosímetr', 'glicemia', 'insulina', 'álcool 70', 'álcool em gel', 'álcool gel',
  'máscara cirúrg', 'máscara descartáv', 'luva descartáv', 'avental cirúrg', 'clínic', 'clinic',
  'policlínic', 'hemogr', 'laudo médic', 'aparelho de pressão', 'internaç hospitalar',
  'leito de internaç', 'exame laboratori', 'exames laboratori', 'consultório odonto',
]

// Termos de saúde inequívoca que VENCEM a exclusão (ex.: "locação de veículos
// ambulância" — é veículo, mas é saúde e deve ser mantido).
const FORTE_SAUDE = ['ambulânci', 'ambulanci']

export function isSaude(s) {
  const l = (s ?? '').toLowerCase()
  if (!l) return false
  if (FORTE_SAUDE.some((k) => l.includes(k))) return true
  if (EXCLUI.some((k) => l.includes(k))) return false
  return SAUDE.some((k) => l.includes(k))
}

export function categoria(s) {
  const l = (s ?? '').toLowerCase()
  if (/tom[óo]graf|tomografia|resson|ultrassom|mam[óo]graf|radiolog|raio-?x|raios x/.test(l)) return 'imagem'
  if (/leito de uti|ventilador pulmonar|respirador|monitor multipar|desfibrilador|ox[íi]metr/.test(l)) return 'uti'
  if (/laborat[óo]ri|analisador|hematolog|reagente|an[áa]lises cl[íi]nic/.test(l)) return 'laboratorio'
  if (/cir[úu]rg|bisturi|mesa cir/.test(l)) return 'cirurgia'
  if (/oncol[óo]g|quimioter|radioter/.test(l)) return 'oncologia'
  if (/medicament|f[áa]rmac|vacina|soro fisiol|medicinal/.test(l)) return 'medicamento'
  return 'outros'
}
