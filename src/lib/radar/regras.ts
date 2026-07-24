// src/lib/radar/regras.ts — motor de regras (classificação de mensagens de chat).
// Módulo PURO. Casa o texto de cada mensagem contra padrões PT-BR (built-in) e
// palavras configuradas pelo usuário, devolvendo as categorias que bateram e a
// prioridade resultante. Espelha a lógica de matchItem em lib/alertas.
// O worker (scripts/radar/run.mjs) reimplementa os mesmos padrões.

import { normalizeText } from '@/lib/text'
import type { CategoriaRegra, Prioridade, RegraRadar } from './types'

// Padrões built-in (aplicados sobre texto SEM acento, minúsculo).
const PADROES: Array<{ tipo: CategoriaRegra; re: RegExp }> = [
  { tipo: 'convocacao', re: /convoca[çc]?[ãa]?o?|convocad|comparec/i },
  { tipo: 'negociacao', re: /negocia|contraproposta|reduzir.*valor|melhor.*lance/i },
  { tipo: 'proposta_ajustada', re: /proposta ajustada|reajust|nova proposta|proposta readequ/i },
  { tipo: 'habilitacao', re: /habilita|inabilita|documenta[çc]?[ãa]?o?|documento.*complement/i },
  { tipo: 'diligencia', re: /dilig[êe]nc/i },
  { tipo: 'recurso', re: /recurso|contrarraz|impugna/i },
  { tipo: 'prazo', re: /prazo|at[ée] (o dia|as|às)|encerr|vencimento|expira/i },
]

// Categorias que exigem ação rápida do fornecedor → prioridade alta.
const ALTA = new Set<CategoriaRegra>(['convocacao', 'prazo', 'recurso', 'diligencia'])

/** Normaliza um CNPJ para só dígitos (menção literal). */
function soDigitos(s: string): string {
  return (s || '').replace(/\D+/g, '')
}

/**
 * Classifica uma mensagem. Retorna todas as categorias que bateram.
 * - built-in por regex; `cnpj` quando o CNPJ monitorado aparece no texto;
 * - regras do usuário: tipo 'keyword' (substring) ou tipo específico com padrão;
 * - 'qualquer' sempre bate (o usuário quer receber tudo daquele processo).
 */
export function classificar(texto: string, cnpj: string | undefined, regras: RegraRadar[] = []): CategoriaRegra[] {
  const hay = normalizeText(texto)
  const cats = new Set<CategoriaRegra>()

  for (const { tipo, re } of PADROES) {
    if (re.test(hay)) cats.add(tipo)
  }

  const cnpjDigits = soDigitos(cnpj ?? '')
  if (cnpjDigits && soDigitos(texto).includes(cnpjDigits)) cats.add('cnpj')

  for (const r of regras) {
    if (!r.ativo) continue
    if (r.tipo === 'qualquer') { cats.add('qualquer'); continue }
    if (r.tipo === 'keyword' && r.padrao) {
      if (hay.includes(normalizeText(r.padrao))) cats.add('keyword')
      continue
    }
    // Regra específica com padrão custom (ex.: reforçar 'convocacao' com outra palavra).
    if (r.padrao && hay.includes(normalizeText(r.padrao))) cats.add(r.tipo)
  }

  return [...cats]
}

/** Prioridade resultante das categorias (alta se qualquer categoria crítica bateu). */
export function prioridadeDe(categorias: CategoriaRegra[] | string[]): Prioridade {
  if (categorias.some((c) => ALTA.has(c as CategoriaRegra))) return 'alta'
  return categorias.length > 0 ? 'normal' : 'baixa'
}
