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
  // `encerr` SOLTO saiu daqui, e a conta é simples: quem fala de prazo escreve "prazo".
  //
  // "Srs. Licitantes, está encerrado o prazo para manifestação" casa por "prazo".
  // "Prazo para recurso encerra amanhã às 18h" casa por "prazo". Mas "o ITEM 213 foi
  // encerrado SEM prorrogação" casava só pelo `encerr` — e num pregão de 213 itens do
  // Licitanet isso são 34 mensagens de prioridade ALTA por sessão, todas rotina de
  // disputa, empurrando a suspensão e a intenção de recurso para fora do topo da caixa.
  // Medido em 14/09/2026, na primeira passada real do conector.
  //
  // Alta demais é o mesmo que alta nenhuma: se tudo é urgente, o cliente para de olhar.
  { tipo: 'prazo', re: /prazo|at[ée] (o dia|as|às)|vencimento|expira/i },
  // MUDANÇA DE ESTADO DO PROCESSO — a categoria que faltava, e faltava caro.
  //
  // "o Processo nº 040/2026 foi SUSPENSO. A REABERTURA será no dia 24/09/2026 09:00" não
  // casava com NADA: sem a palavra "prazo", sem "convocação", sem "recurso". Uma mensagem
  // que remarca a agenda do fornecedor caía como prioridade BAIXA. O mesmo valia para
  // revogação, anulação, prorrogação e adiamento.
  //
  // Apareceu ao ligar o Licitanet (14/09/2026), que é justamente o portal que escreve
  // esses avisos por extenso — mas o buraco sempre esteve lá, para todos os portais.
  { tipo: 'status_processo', re: /suspens|suspend|retomad|reabertura|reaberto|revoga|anulad|cancelad|prorrogad[oa]|prorroga[çc][ãa]o d[aeo]|adiad|remarcad/i },
]

// Categorias que exigem ação rápida do fornecedor → prioridade alta.
const ALTA = new Set<CategoriaRegra>(['convocacao', 'prazo', 'recurso', 'diligencia', 'status_processo'])

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
