// src/lib/tipo-sql.ts — utilitários de TIPO DE FORNECIMENTO no lado do banco.
//
// A classificação por regex foi MATERIALIZADA como coluna gerada `tipo_fornecimento`
// em contratacoes/resultados (ver db/schema.sql e scripts/migrate-tipo-fornecimento.mjs),
// então as queries filtram por igualdade indexada (`tipo_fornecimento = $1`) em vez de
// rodar o CASE por request. Aqui ficam só os helpers de validação do parâmetro.

import type { TipoFornecimento } from './types'

export const TIPO_FORNECIMENTO_KEYS: TipoFornecimento[] = [
  'equipamento', 'medicamento', 'opme', 'servico', 'acessorio', 'outros',
]

export function isTipoFornecimento(v: string | null | undefined): v is TipoFornecimento {
  return !!v && (TIPO_FORNECIMENTO_KEYS as string[]).includes(v)
}
