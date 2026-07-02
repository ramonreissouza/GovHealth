// src/lib/tipo-sql.ts — classificação de TIPO DE FORNECIMENTO em SQL (Postgres),
// espelhando `classificarTipo` (score-engine.ts) para que os agregados/filtros do
// banco (gráfico, concorrentes, alertas) reajam ao mesmo eixo usado na lista de
// oportunidades. As classes de caractere ([çc], [ãa]…) toleram texto com/sem acento.
// Ordem importa (primeiro match vence): servico → opme → medicamento → equipamento → acessorio.

import type { TipoFornecimento } from './types'

export const TIPO_FORNECIMENTO_KEYS: TipoFornecimento[] = [
  'equipamento', 'medicamento', 'opme', 'servico', 'acessorio', 'outros',
]

export function isTipoFornecimento(v: string | null | undefined): v is TipoFornecimento {
  return !!v && (TIPO_FORNECIMENTO_KEYS as string[]).includes(v)
}

// Expressão SQL que classifica a coluna `col` (descrição/objeto) numa TipoFornecimento.
export function tipoFornecimentoCaseSql(col: string): string {
  const c = `coalesce(${col}, '')`
  return `CASE
    WHEN ${c} ~* '(manuten[çc]|reparo|conserto|instala[çc]|reforma|loca[çc][ãa]o|aluguel|presta[çc][ãa]o de servi|servi[çc]os? de|m[ãa]o de obra|limpeza|higieniz|esteriliza[çc]|lavanderia|dedetiz|res[íi]duo|transporte de pacient|remo[çc][ãa]o de pacient|servi[çc]o.*ambul[âa]nc|calibra[çc]|gases medicinais|oxig[êe]nio medicinal)' THEN 'servico'
    WHEN ${c} ~* '([óo]rtese|pr[óo]tese|opme|implante|stent|marca-?passo|osteoss[íi]ntese|haste (femoral|intramedular)|placa (de )?tit[âa]nio|parafuso (ortop|pedicular)|lente intraocular|enxerto [óo]sseo|fio de kirschner)' THEN 'opme'
    WHEN ${c} ~* '(medicament|f[áa]rmaco|farmac[êe]ut|antibi[óo]tic|insumo farmac|princ[íi]pio ativo|vacina|soro fisiol|injet[áa]vel|comprimido|ampola|quimioter[áa]pico)' THEN 'medicamento'
    WHEN ${c} ~* '(tom[óo]grafo|resson[âa]ncia|ultrassom|ultrassonograf|raio-?x|mam[óo]grafo|ventilador|respirador|monitor (multi|card|de )|desfibrilador|eletrocardi[óo]grafo|ox[íi]metro|autoclave|equipamento m[ée]dic|equipamento hospitalar|equipamento odontol|mesa cir[úu]rg|foco cir[úu]rg|maca|cama hospitalar|incubadora|bomba de infus|aparelho de|cadeira odontol)' THEN 'equipamento'
    WHEN ${c} ~* '(acess[óo]rio|insumo|descart[áa]vel|seringa|agulha|luva|gaze|atadura|cateter|sonda|equipo|eletrodo|m[áa]scara|avental|compressa|curativo|fralda|material m[ée]dic|material hospitalar|material de consumo|reagente|kit (para|de) (teste|diagn))' THEN 'acessorio'
    ELSE 'outros'
  END`
}
