// src/lib/categoria-mercado.ts — classificação de MERCADO dos itens de saúde a
// partir da descrição (nome_catmat). Heurística por palavras-chave, ajustável.
// Usada para os filtros da tela de Vencedores (e reutilizável em outras telas).

export const CATEGORIAS = [
  { key: 'equip_medico', label: 'Equip. médicos' },
  { key: 'medicamento', label: 'Medicamentos' },
  { key: 'opme', label: 'OPME' },
  { key: 'odontologico', label: 'Odontológico' },
  { key: 'servico_saude', label: 'Serviços de saúde' },
  { key: 'acessorio', label: 'Acessórios' },
  { key: 'laboratorio', label: 'Laboratório' },
  { key: 'outros', label: 'Outros' },
] as const

export type CategoriaKey = (typeof CATEGORIAS)[number]['key']

export const CATEGORIA_KEYS = CATEGORIAS.map((c) => c.key)
export const CATEGORIA_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.key, c.label]))

// Ponte entre a taxonomia CLÍNICA do Setup da Empresa (imagem/uti/laboratorio/
// cirurgia/oncologia/medicamento/outros) e a taxonomia de MERCADO desta classificação.
// Usada para pré-filtrar Fornecedores/Concorrentes pelas categorias de interesse da
// empresa (ex.: Siemens = laboratório + equipamentos → não mostra OPME, medicamentos, etc.).
const CLINICA_PARA_MERCADO: Record<string, CategoriaKey> = {
  imagem: 'equip_medico',
  uti: 'equip_medico',
  cirurgia: 'equip_medico',
  oncologia: 'equip_medico',
  outros: 'equip_medico',
  laboratorio: 'laboratorio',
  medicamento: 'medicamento',
  // As categorias novas já nascem alinhadas à taxonomia de mercado — várias têm
  // correspondente exato, o que antes se perdia dentro de 'outros'.
  equipamento_medico: 'equip_medico',
  manutencao: 'servico_saude',
  servicos_medicos: 'servico_saude',
  ambulancia: 'servico_saude',
  odontologia: 'odontologico',
  opme: 'opme',
  material_hospitalar: 'acessorio',
}

/** Converte as categorias clínicas do Setup nas categorias de mercado desta tela. */
export function categoriasMercadoDoSetup(clinicas: string[]): CategoriaKey[] {
  const set = new Set<CategoriaKey>()
  for (const c of clinicas) {
    const m = CLINICA_PARA_MERCADO[c]
    if (m) set.add(m)
  }
  return [...set]
}

// Regras de classificação, na ordem em que são testadas (primeiro match vence).
// Cada entrada é [categoria, alternativas de regex].
const REGRAS: Array<[CategoriaKey, string]> = [
  // APARELHOS INCONFUNDÍVEIS — vêm antes de tudo porque nenhum deles é serviço,
  // OPME ou medicamento, e a ficha técnica deles cita justamente esses termos. Sem
  // esta faixa, "CENTRAL, de monitorização" virava serviço (a spec fala em "serviços
  // de"), "SISTEMA, de cápsula endoscópica" virava medicamento (por "cápsula") e o
  // monitor virava OPME (por "marca-passo" na especificação do ECG).
  ['equip_medico', 'central de monitor(iza|a)|sistema de monitora|m[óo]dulo de (capnografia|d[ée]bito card)|endosc[óo]p|colonosc[óo]p|broncosc[óo]p|videolaparosc|tom[óo]graf|resson[âa]nc magn|mam[óo]graf|ventilador pulmonar|desfibrilador|cardioversor|autoclave|incubadora|monitor multiparam'],
  // `diálise` e `esterilização` eram palavras soltas aqui e engoliam PRODUTO:
  // "KIT, cateter, para hemodiálise" virava serviço, e uma malha de curativo também
  // — a ficha dela diz "registro, validade e esterilização", que é ATRIBUTO do
  // produto, não o serviço de esterilizar instrumental. Ambas passam a exigir
  // contexto de serviço.
  ['servico_saude', 'presta[çc][ãa]o de servi|servi[çc]os? de|loca[çc][ãa]o|manuten[çc][ãa]o|m[ãa]o de obra|plant[ãa]o|gerenciamento|amb[uû]l[âa]nci|servi[çc]o.{0,20}(di[áa]lise|esteriliza)|esteriliza[çc][ãa]o de (material|instrumental|artigo)|sess[õo]es de (hemo)?di[áa]lise|tratamento (hemo)?dial[íi]tic'],
  ['odontologico', 'odontol[óo]g|broca (de )?(alta|baixa) rota|resina composta|cimento odontol|lima (uso )?odontol|am[áa]lgama|guta.?percha|endod[ôo]ntic|ion[ôo]mero|brackets?'],
  ['opme', 'pr[óo]tese|[óo]rtese|implant|stent|marca[ -]?passo|lente intraocular|enxerto [óo]sse|cimento [óo]sse|fixador extern|placa (de tit[âa]nio|ortop)|parafuso (pedicular|ortop|cir[úu]rg)|haste (femoral|umeral|intramedular)|prego intramedular|pequenos e grandes fragmentos|opme'],
  ['medicamento', 'medicament|f[áa]rmac|comprimido|ampola|injet[áa]vel|c[áa]psula|dr[áa]gea|xarope|vacina|soro fisiol|antibi[óo]tic|insulina|medicinal|cloridrato|cloreto de s[óo]dio|digluconato|s[óo]dic|glicose|lidoca[íi]na|amoxicilina|dexametasona|dipirona|clorexidina|escopolamina|bromet|dieta enteral|nutri[çc][ãa]o enteral|solu[çc][ãa]o (fisiol|glicos|de ringer)'],
  ['laboratorio', 'reagente|kit (diagn|para teste|de teste)|teste r[áa]pido|anal[íi]ses cl[íi]nic|analisador|l[âa]mina (para|de) micros|tubo (de coleta|a v[áa]cuo|para coleta)|amostra biol[óo]gic|sorolog|hemogr|gasometr|bioqu[íi]mic|antibiograma|meio de cultura|corante|anticorpo'],
  // `ventilador` sem qualificador: o nome do produto vem como "VENTILADOR PULMONAR",
  // mas também como "Ventilador Artificial Eletrônico" e "VENTILADOR DE TRANSPORTE".
  // Só é seguro porque o 1º passo é ANCORADO — "circuito para ventilador" não casa.
  ['equip_medico', 'equipamento|aparelho|monitor (multi|card|de sinais|de paciente)|ventilador|respirador|desfibrilador|autoclave|foco cir[úu]rg|mesa cir[úu]rg|cama hospitalar|bisturi[,;: ]+(el[ée]tr|de alta frequ)|tom[óo]graf|resson[âa]nc|ultrassom|raio-?x|eletrocardi[óo]graf|ox[íi]metr|bomba de infus|cadeira de rodas|nebuliz|microsc[óo]pio|centr[íi]fuga|incubadora|ber[çc]o aquec|carro de emerg[êe]nc|aspirador (cir[úu]rg|hospitalar)|laring[óo]sc[óo]pio|capn[óo]graf|eletroencefal|dermat[óo]sc[óo]pio|otosc[óo]pio|esfigmoman[ôo]metr'],
  ['acessorio', 'seringa|agulha|cateter|sonda|gaze|atadura|luva|m[áa]scara|compressa|equipo|scalp|esparadr|algod[ãa]o|curativo|fralda|[áa]lcool|descart[áa]v|material penso|abaixador|lanceta|coletor|c[âa]nula|tubo endotraqueal|dreno|l[âa]mina (de )?bisturi|fita (hospitalar|cir[úu]rg)|traqueostomia|sutura|fio (cir[úu]rg|de sutura)|pin[çc]a'],
]

/**
 * Expressão SQL (Postgres) que classifica a coluna `col` numa CategoriaKey.
 *
 * DOIS PASSOS, e a razão é um erro real: a descrição do CATMAT é "NOME DO PRODUTO,
 * <especificação técnica longa>", e a especificação cita materiais de outras
 * categorias. A ficha de um monitor multiparâmetro diz "detecção de MARCA-PASSO" no
 * item de ECG, e a de um ventilador pulmonar cita "AR COMPRIMIDO" e "oxigênio
 * MEDICINAL". Varrendo o texto inteiro numa passada só, e com OPME/medicamento
 * testados antes de equipamento, o monitor era vendido como OPME e o ventilador como
 * medicamento — uma menção acessória ganhava do produto de verdade.
 *
 * Passo 1: aplica as regras ANCORADAS ao NOME do produto (o trecho antes da primeira
 * vírgula/dois-pontos/ponto). É o que o comprador escreveu como identidade do item, e
 * a âncora impede que "CIRCUITO PARA VENTILADOR" vire equipamento.
 * Passo 2: só quando o nome não decide, cai para as mesmas regras no texto inteiro
 * (comportamento antigo) — descrições que não seguem o padrão continuam classificadas.
 */
/**
 * Expressão SQL da categoria de mercado para usar nas consultas de `resultados`.
 *
 * Lê a COLUNA MATERIALIZADA (`resultados.categoria_mercado`) em vez de recalcular o
 * CASE linha a linha. O CASE abaixo são ~16 regexes por linha, sem índice possível,
 * sobre 288 mil resultados; medido em produção, um ranking que leva 0,4 s filtrando
 * só por UF passava a 23,6 s ao somar o filtro de categoria — e a tela de Breakdown,
 * que dispara 6 consultas dessas de uma vez, simplesmente nunca terminava de abrir.
 *
 * A coluna é GENERATED ALWAYS: linha nova do ETL já nasce classificada, sem mudança
 * no ETL. Em compensação a expressão fica CONGELADA no banco — mexeu em `REGRAS`,
 * rode `npm run categoria:migrate` (a migração compara a impressão digital da
 * expressão e recria a coluna quando ela muda).
 */
export function categoriaSql(alias = 'r'): string {
  return `${alias}.categoria_mercado`
}

/** O CASE cru. Hoje só a migração usa — as consultas leem a coluna (ver acima). */
export function categoriaCaseSql(col: string): string {
  const c = `coalesce(${col}, '')`
  // Antes de recortar o nome, tira o que vem ANTES dele: rótulo ("Descrição:",
  // "Objeto:") e código CATMAT ("(2808552) - ", "0702050032 "). Sem isso o recorte
  // parava no primeiro `:` e o nome do produto virava a palavra "Descrição" — foi o
  // que jogou "Descrição: CENTRAL, de monitorização" para o passo do texto inteiro.
  const semRotulo = `regexp_replace(${c}, '^\\s*((descri[çc][ãa]o|objeto|item|produto)\\s*:\\s*|\\(?[0-9]{6,}\\)?\\s*[-–]?\\s*)+', '', 'i')`
  // O nome do produto: até o primeiro separador, limitado para não engolir a spec de
  // descrições sem pontuação.
  const nome = `substring(${semRotulo} from '^[^,:;.]{0,80}')`
  const passo = (alvo: string, ancora: boolean) => REGRAS
    .map(([k, re]) => `WHEN ${alvo} ~* '${ancora ? '^ *(' : '('}${re})' THEN '${k}'`)
    .join('\n    ')
  return `CASE
    ${passo(nome, true)}
    ${passo(c, false)}
    ELSE 'outros'
  END`
}
