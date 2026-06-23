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

// Expressão SQL (Postgres) que classifica a coluna `col` numa CategoriaKey.
// Ordem importa (primeiro match vence). `~*` é regex case-insensitive.
export function categoriaCaseSql(col: string): string {
  const c = `coalesce(${col}, '')`
  return `CASE
    WHEN ${c} ~* '(presta[çc][ãa]o de servi|servi[çc]os? de|loca[çc][ãa]o|manuten[çc][ãa]o|m[ãa]o de obra|plant[ãa]o|gerenciamento|esteriliza[çc][ãa]o|amb[uû]l[âa]nci|hemodi[áa]lise|di[áa]lise)' THEN 'servico_saude'
    WHEN ${c} ~* '(odontol[óo]g|broca (de )?(alta|baixa) rota|resina composta|cimento odontol|lima (uso )?odontol|am[áa]lgama|guta.?percha|endod[ôo]ntic|ion[ôo]mero|brackets?)' THEN 'odontologico'
    WHEN ${c} ~* '(pr[óo]tese|[óo]rtese|implant|stent|marca[ -]?passo|lente intraocular|enxerto [óo]sse|cimento [óo]sse|fixador extern|placa (de tit[âa]nio|ortop)|parafuso (pedicular|ortop|cir[úu]rg)|haste (femoral|umeral|intramedular)|prego intramedular|pequenos e grandes fragmentos|opme)' THEN 'opme'
    WHEN ${c} ~* '(medicament|f[áa]rmac|comprimido|ampola|injet[áa]vel|c[áa]psula|dr[áa]gea|xarope|vacina|soro fisiol|antibi[óo]tic|insulina|medicinal|cloridrato|cloreto de s[óo]dio|digluconato|s[óo]dic|glicose|lidoca[íi]na|amoxicilina|dexametasona|dipirona|clorexidina|escopolamina|bromet|dieta enteral|nutri[çc][ãa]o enteral|solu[çc][ãa]o (fisiol|glicos|de ringer))' THEN 'medicamento'
    WHEN ${c} ~* '(reagente|kit (diagn|para teste|de teste)|teste r[áa]pido|anal[íi]ses cl[íi]nic|analisador|l[âa]mina (para|de) micros|tubo (de coleta|a v[áa]cuo|para coleta)|amostra biol[óo]gic|sorolog|hemogr|gasometr|bioqu[íi]mic|antibiograma|meio de cultura|corante|anticorpo)' THEN 'laboratorio'
    WHEN ${c} ~* '(equipamento|aparelho|monitor (multi|card|de sinais|de paciente)|ventilador pulmonar|respirador|desfibrilador|autoclave|foco cir[úu]rg|mesa cir[úu]rg|cama hospitalar|bisturi el[ée]tr|tom[óo]graf|resson[âa]nc|ultrassom|raio-?x|eletrocardi[óo]graf|ox[íi]metr|bomba de infus|cadeira de rodas|nebuliz|microsc[óo]pio|centr[íi]fuga|incubadora|ber[çc]o aquec)' THEN 'equip_medico'
    WHEN ${c} ~* '(seringa|agulha|cateter|sonda|gaze|atadura|luva|m[áa]scara|compressa|equipo|scalp|esparadr|algod[ãa]o|curativo|fralda|[áa]lcool|descart[áa]v|material penso|abaixador|lanceta|coletor|c[âa]nula|tubo endotraqueal|dreno|l[âa]mina (de )?bisturi|fita (hospitalar|cir[úu]rg)|traqueostomia|sutura|fio (cir[úu]rg|de sutura)|pin[çc]a)' THEN 'acessorio'
    ELSE 'outros'
  END`
}
