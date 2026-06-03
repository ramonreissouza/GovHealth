// src/lib/format.ts
// Fonte ÚNICA de helpers de formatação de exibição. Antes, `formatBRL`,
// `formatDate` e `diasRestantes` estavam duplicados (com implementações
// divergentes) em ~13 páginas/componentes. Há duas variantes de moeda porque
// dois estilos coexistem de propósito:
//   - formatBRL        → tabelas/detalhe (preciso): "R$ 1,23M"
//   - formatBRLCompact → badges/gráficos (denso): "R$1.2M"

/**
 * Moeda BRL abreviada, estilo tabela/detalhe: "R$ 1,23M" / "R$ 450K" / "R$ 999,00".
 * Retorna '—' para valores vazios ou ≤ 0.
 */
export function formatBRL(v?: number | null): string {
  if (v == null || v <= 0) return '—'
  if (v >= 1_000_000_000) return `R$ ${(v / 1_000_000_000).toFixed(2).replace('.', ',')}B`
  if (v >= 1_000_000)     return `R$ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`
  if (v >= 1_000)         return `R$ ${(v / 1_000).toFixed(0)}K`
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Moeda BRL compacta, estilo badge/gráfico: "R$1.2M" / "R$450K".
 * Retorna '—' para valores vazios ou ≤ 0.
 */
export function formatBRLCompact(v?: number | null): string {
  if (v == null || v <= 0) return '—'
  if (v >= 1_000_000_000) return `R$${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000)     return `R$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)         return `R$${Math.round(v / 1_000)}K`
  return `R$${Math.round(v)}`
}

/** Data por extenso curta pt-BR: "31/05/2026". Retorna '—' se inválida/vazia. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Dias até a data (negativo = passou). null se não houver data. */
export function diasRestantes(iso?: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}
