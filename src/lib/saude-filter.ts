import type { CategoriaEquipamento } from '@/lib/types'

// src/lib/saude-filter.ts — espelho em TS de scripts/saude-filter.mjs.
// Filtro de PRECISÃO "é compra de saúde?" a partir do
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

// ── categoria: MESMA taxonomia de 14 do ETL ─────────────────────────────
// Espelho fiel de `categoria()` em scripts/saude-filter.mjs (transcrito por script,
// não à mão — copiar 14 regex acentuadas é como se introduz divergência silenciosa).
// A ORDEM DAS REGRAS É PARTE DA REGRA: as específicas vêm antes das gerais, senão
// 'equipamento_medico' rouba de 'opme', 'manutencao' e 'odontologia'. Mexeu lá?
// Espelhe aqui — uma cópia velha faria o cron diário gravar a taxonomia antiga (a
// de 7 categorias, em que 'outros' era 65 por cento da base).
export function categoria(s: string | null | undefined): CategoriaEquipamento {
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
