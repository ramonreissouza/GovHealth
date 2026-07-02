// src/lib/coleta-meta.ts — proveniência REAL do dado do banco (item 7 do TOP10 v2).
// As APIs de resultados devolviam `atualizadoEm: new Date()` (hora da requisição),
// o que deixava o selo do Topbar decorativo. Aqui buscamos o timestamp verdadeiro
// da última coleta do ETL, para o selo refletir "coletado há Xh" de verdade.
//
// Sinais de "última coleta":
//   - contratacoes.coletado_em     → quando cada contratação entrou no banco
//   - etl_checkpoint.atualizado_em → quando o ETL avançou pela última vez
// Pegamos o mais recente entre os dois. Cache em memória (60s) para não consultar
// o banco a cada request.

import { queryOne } from '@/lib/db'

let cache: { at: number; value: string | null } | null = null
const TTL_MS = 60_000

/** ISO real da última coleta do ETL, ou null se indisponível. Cacheado por 60s. */
export async function ultimaColetaResultados(): Promise<string | null> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.value
  try {
    const row = await queryOne<{ ultima: string | Date | null }>(
      `SELECT GREATEST(
         (SELECT MAX(coletado_em)  FROM contratacoes),
         (SELECT MAX(atualizado_em) FROM etl_checkpoint)
       ) AS ultima`,
    )
    const value = row?.ultima ? new Date(row.ultima).toISOString() : null
    cache = { at: now, value }
    return value
  } catch {
    // Banco ausente/erro: não inventa horário — o selo cai no fallback "ao vivo".
    return null
  }
}
