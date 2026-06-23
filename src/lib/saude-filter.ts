// src/lib/saude-filter.ts — filtro de PRECISÃO "é compra de saúde?" a partir do
// texto do objeto/descrição. Mesma estratégia do scripts/saude-filter.mjs (ETL):
//   1) EXCLUI: contexto claramente não-saúde (eventos/shows, combustível/veículos,
//      obras/vias, escolar/alimentação, limpeza pública...) → descarta;
//   2) SAUDE: exige um termo específico de saúde (sem substrings largas como
//      'equip'/'uti'/'monitor' que pegavam "utilização", "monitoramento", etc.);
//   3) ambulância vence a exclusão de veículo (FORTE_SAUDE).

const EXCLUI = [
  // eventos / shows / cultura
  'show', 'banda', 'pagode', 'sertanej', 'forró', 'forro', 'baile', 'festa', 'festiv',
  'carnaval', 'réveillon', 'reveillon', 'micareta', 'trio elétrico', 'trio eletrico',
  'palco', 'sonoriz', 'iluminaç', 'som e luz', 'estrutura tubular', 'tenda', 'toldo',
  'arquibancada', 'evento', 'buffet', 'coffee', 'brinde', 'troféu', 'trofeu', 'medalha',
  'premiaç', 'locação de estrutura', 'locacao de estrutura', 'banda de música',
  'bilheteria', 'fogos de artif', 'pirotécn', 'pirotecn', 'atração artístic',
  // combustível / veículos
  'combustív', 'combustiv', 'gasolina', 'óleo diesel', 'oleo diesel', 'etanol',
  'lubrificante', 'pneu', 'automotiv', 'veícul', 'veicul', 'frota',
  // obras / vias / saneamento
  'pavimentaç', 'pavimentac', 'asfalt', 'terraplan', 'recapea', 'drenagem', 'obra de',
  'construção de', 'construcao de', 'reforma e ampliaç', 'sinalizaç viár',
  // alimentação / escolar
  'merenda', 'transporte escolar', 'material escolar', 'uniforme escolar',
  'alimentação escolar', 'alimentacao escolar', 'gênero aliment', 'genero aliment',
  'cesta básica', 'cesta basica',
  // serviços diversos não-clínicos
  'limpeza urbana', 'limpeza públic', 'limpeza public', 'coleta de lixo', 'coleta de resíduo',
  'capina', 'roçagem', 'rocagem', 'publicidade', 'assessoria de imprensa',
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
  'monitor cardíac', 'monitor fetal', 'raio-x', 'raio x', 'raios x', 'luva de procedimento',
  'luva cirúrg', 'vigilância sanitár', 'vigilância epidemiológic', 'atenção básica',
  'atencao basica', 'centro de saúde', 'farmácia básica',
  'diális', 'dialis', 'curativo', 'fralda', 'ortopéd', 'ortoped', 'protétic', 'nebuliz',
  'glicosímetr', 'glicemia', 'insulina', 'álcool 70', 'álcool em gel', 'álcool gel',
  'máscara cirúrg', 'máscara descartáv', 'luva descartáv', 'avental cirúrg', 'clínic', 'clinic',
  'policlínic', 'hemogr', 'laudo médic', 'aparelho de pressão', 'internaç hospitalar',
  'leito de internaç', 'exame laboratori', 'exames laboratori', 'consultório odonto',
  'traqueostomia', 'cânula', 'autoclave', 'hemoterapia', 'rouparia hospitalar',
]

const FORTE_SAUDE = ['ambulânci', 'ambulanci']

export function isSaude(texto: string | null | undefined): boolean {
  const l = (texto ?? '').toLowerCase()
  if (!l) return false
  if (FORTE_SAUDE.some((k) => l.includes(k))) return true
  if (EXCLUI.some((k) => l.includes(k))) return false
  return SAUDE.some((k) => l.includes(k))
}
