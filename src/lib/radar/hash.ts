// src/lib/radar/hash.ts — hash de mensagem para deduplicação/idempotência.
// A mesma mensagem, recapturada em sync posteriores, gera o MESMO hash →
// UNIQUE(msg_hash) + ON CONFLICT DO NOTHING evita alertas duplicados.
// O worker (scripts/radar/run.mjs) usa a MESMA fórmula.

import { createHash } from 'node:crypto'

// Separador improvável (U+241F SYMBOL FOR UNIT SEPARATOR) evita colisão por concatenação.
const SEP = '␟'

/**
 * Hash estável de uma mensagem. NÃO usa `capturado_em` (mudaria a cada sync e
 * duplicaria). Quando o portal não expõe horário confiável, passe horario = ''.
 */
export function msgHash(input: {
  conectorId: string
  licitacaoId: string
  autor?: string | null
  texto: string
  horarioOrigem?: string | null
}): string {
  const partes = [
    input.conectorId,
    input.licitacaoId,
    (input.autor ?? '').trim(),
    input.texto.trim(),
    (input.horarioOrigem ?? '').trim(),
  ]
  return createHash('sha256').update(partes.join(SEP)).digest('hex')
}
