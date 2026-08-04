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

// Exclusões que precisam de REGEX porque o casamento por substring falha.
//
// Motivo medido: 'gênero aliment' (lista acima) NÃO casa com "gêneros alimentícios"
// — o 's' do plural quebra a substring contígua. Resultado: 626 compras de comida
// entraram na base de saúde, uma delas classificada como 'uti'. O teste que expôs
// isso: isSaude('...gênero alimentício...') = false, isSaude('...gêneros
// alimentícios...') = true.
//
// Estes padrões são ANCORADOS em início de palavra de propósito. Sem a âncora,
// /obras? de/ casa dentro de "manobras de" — medi 1 registro real sendo pego assim
// ("capacitação presencial em noções de..."), então a âncora não é teórica.
const EXCLUI_RE = [
  /(^|[^a-zà-ú])g[êe]neros?\s+aliment/i,
  /(^|[^a-zà-ú])cestas?\s+b[áa]sicas?/i,
  /(^|[^a-zà-ú])uniformes?\s+escolar/i,
  // Obra/construção só exclui em contexto de ENGENHARIA. "Obras de reforma de UBS"
  // é obra civil (não é venda de produto de saúde), mas o padrão solto pegava
  // qualquer "…obras de…" — inclusive dentro de outra palavra.
  /(^|[^a-zà-ú])(obras?|constru[çc][õo]es)\s+de\s+(engenharia|constru|reforma|amplia|adequa|infraestrutura)/i,
]

// Termos de saúde inequívoca que VENCEM a exclusão (ex.: "locação de veículos
// ambulância" — é veículo, mas é saúde e deve ser mantido).
//
// Medi se isto estava deixando entrar combustível/pneu de ambulância (que não é
// oportunidade para fornecedor de material médico): NÃO está. Os registros com
// "ambulância" + "combustível" são compras da própria ambulância que citam o
// combustível na ESPECIFICAÇÃO do veículo. Por isso a lista fica como está.
const FORTE_SAUDE = ['ambulânci', 'ambulanci']

export function isSaude(s) {
  const l = (s ?? '').toLowerCase()
  if (!l) return false
  if (FORTE_SAUDE.some((k) => l.includes(k))) return true
  if (EXCLUI.some((k) => l.includes(k))) return false
  if (EXCLUI_RE.some((re) => re.test(l))) return false
  return SAUDE.some((k) => l.includes(k))
}

// A ordem é significativa: o PRIMEIRO padrão que casa vence.
//
// As seis categorias originais vêm primeiro e com o padrão inalterado. Isso é
// deliberado, não acidental: garante que nenhum registro já classificado troque
// de balde quando esta lista cresce. Se 'material_hospitalar' viesse antes de
// 'cirurgia', um "material médico-cirúrgico" migraria de balde e sumiria da
// seleção de quem filtra por cirurgia — a tela do cliente perderia licitações
// por causa de uma melhoria. As categorias novas só pescam o que caía em 'outros'.
export function categoria(s) {
  const l = (s ?? '').toLowerCase()

  // ── as 6 originais, intactas ────────────────────────────────────────────────
  if (/tom[óo]graf|tomografia|resson|ultrassom|mam[óo]graf|radiolog|raio-?x|raios x/.test(l)) return 'imagem'
  if (/leito de uti|ventilador pulmonar|respirador|monitor multipar|desfibrilador|ox[íi]metr/.test(l)) return 'uti'
  if (/laborat[óo]ri|analisador|hematolog|reagente|an[áa]lises cl[íi]nic/.test(l)) return 'laboratorio'
  if (/cir[úu]rg|bisturi|mesa cir/.test(l)) return 'cirurgia'
  if (/oncol[óo]g|quimioter|radioter/.test(l)) return 'oncologia'
  if (/medicament|f[áa]rmac|vacina|soro fisiol|medicinal/.test(l)) return 'medicamento'

  // ── categorias novas, do específico para o geral ────────────────────────────
  // Drenam o balde 'outros', que sozinho guardava 61.211 dos 93.595 registros
  // (65%) — e portanto ficava invisível para qualquer cliente que filtrasse
  // por categoria no Setup da Empresa.

  if (/odontol[óo]g|dent[áa]ri|dentist|bucal|end[óo]dont|ortod[ôo]nt|periodont|amalgama|am[áa]lgama/.test(l)) return 'odontologia'

  if (/amb[uú]l[âa]nci|\bsamu\b|remo[çc][ãa]o de paciente|transporte de paciente|transporte sanit/.test(l)) return 'ambulancia'

  // 'implant' cru pegaria "implantação de sistema" (709 registros medidos) —
  // por isso exige 'implante(s)' ou 'implantável'.
  if (/pr[óo]tese|[óo]rtese|implantes?[^a-z]|implant[áa]vel|stent|marca.?passo|lente intraocular|osteoss[íi]ntese|fixador extern|placa de tit[âa]nio/.test(l)) return 'opme'

  // "manutenção das atividades da secretaria de saúde" (250 registros medidos) é
  // custeio, não manutenção de equipamento — daí exigir o complemento.
  if (/manuten[çc][ãa]o (preventiva|corretiva|de equipament|em equipament|de aparelh|predial)|corretiva e preventiva|preventiva e corretiva|assist[êe]ncia t[ée]cnica|calibra[çc][ãa]o|conserto|reparo (de|em)/.test(l)) return 'manutencao'

  // NÃO existe categoria por local de atendimento (UBS / atenção básica / ESF).
  // Tentei e medi: o balde ficava com 2.388 registros cujo único elo era o lugar
  // — equipamento, material penso, mobiliário, gerador de energia, reforma de
  // prédio e até gêneros alimentícios no mesmo saco. Para um fornecedor isso não
  // informa nada ("é de UBS" não diz o que vender), e por vir antes das regras de
  // produto ele roubava registros de equipamento_medico e material_hospitalar.
  // Melhor classificar pelo QUE se compra e deixar o resto honestamente em 'outros'.

  if (/presta[çc][ãa]o de servi[çc]os? (m[ée]dic|de sa[úu]de|especializ|hospitalar)|atendimento (m[ée]dic|especializ|ambulatori|hospitalar)|credenciamento|plant[ãa]o|m[ãa]o de obra|profissionais (da|de) sa[úu]de|consultas? (m[ée]dic|especializ)|exames? (m[ée]dic|especializ|complementar)|esteriliza[çc][ãa]o|hemodi[áa]lise|di[áa]lise/.test(l)) return 'servicos_medicos'

  if (/material (m[ée]dic|hospitalar|penso|de consumo|odontol)|materiais (m[ée]dic|hospitalar|de consumo|e insumo|odontol)|insumo|descart[áa]v|seringa|agulha|cateter|\bsonda|gaze|atadura|luva|m[áa]scara|compressa|equipo|esparadr|algod[ãa]o|curativo|fralda|[áa]lcool|sutura|abaixador|lanceta|c[âa]nula|dreno/.test(l)) return 'material_hospitalar'

  // 'material/materiais permanente(s)' é o termo padrão da compra pública para bem
  // durável — na prática é equipamento, e responde por boa parte das compras com
  // emenda parlamentar ("equipamento e material permanente para a UBS").
  if (/equipament|aparelh|instrumental|mobili[áa]rio|m[óo]veis|materia(l|is) permanente|bens? permanente|cama hospitalar|\bmaca\b|autoclave|cadeira de rodas|nebuliz|balan[çc]a|otosc[óo]pio|esfigmoman|estetosc[óo]pio|eletrocardi[óo]graf|bomba de infus|incubadora|ber[çc]o aquec/.test(l)) return 'equipamento_medico'

  return 'outros'
}
