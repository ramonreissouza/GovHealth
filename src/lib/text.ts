// src/lib/text.ts
// Utilidades de texto compartilhadas. Centraliza a normalização de acentos,
// antes duplicada em pncp/comprasgov/score-engine/transferegov/dou/cnes.

/** Remove diacríticos (acentos), preservando o caso. Ex.: "Saúde" → "Saude". */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Normaliza para comparação case/acento-insensível. Ex.: "São Paulo" → "sao paulo". */
export function normalizeText(s: string): string {
  return stripAccents(s).toLowerCase().trim()
}

/** Chave canônica de município (acento-insensível, maiúsculas). */
export function normalizeKey(s: string): string {
  return stripAccents(s).toUpperCase().trim()
}
