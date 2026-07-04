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

/**
 * Casa uma busca do usuário contra um ou mais textos, de forma tolerante:
 * ignora acentos/caixa e trata plural simples (sufixo "s"). Todos os termos da
 * busca precisam aparecer (AND). Ex.: "luvas cirurgicas" casa "LUVA CIRÚRGICA".
 */
export function matchesTermo(query: string, ...textos: (string | null | undefined)[]): boolean {
  const termos = normalizeText(query).split(/\s+/).filter(Boolean)
  if (termos.length === 0) return true
  const alvo = textos.map((t) => normalizeText(t ?? '')).join('  ')
  return termos.every((termo) =>
    alvo.includes(termo) || (termo.endsWith('s') && alvo.includes(termo.slice(0, -1)))
  )
}
