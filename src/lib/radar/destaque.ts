// src/lib/radar/destaque.ts — DESTAQUE de palavras-chave dentro do texto da mensagem.
// Módulo PURO (sem DB) — usado no client para pintar os termos monitorados na thread,
// como o "Monitorar Chat" da ConLicitação faz: âmbar para as palavras-chave do usuário
// e verde para anexo/arquivo (a mensagem que traz documento é a mais urgente de ver).
//
// Casa SEM acento e SEM caixa (via normalizeText), mas devolve os índices do texto
// ORIGINAL — o usuário lê a mensagem como o pregoeiro escreveu.

import { normalizeText, stripAccents } from '@/lib/text'

export type TipoDestaque = 'chave' | 'anexo'

export interface Trecho {
  texto: string
  tipo: TipoDestaque | null
}

// Termos que indicam ANEXO/arquivo — destacados em verde (classe própria).
const ANEXO_TERMOS = ['anexo', 'arquivo', 'documento anexado', 'enviar o arquivo', 'enviou o arquivo']
// Extensões de arquivo citadas no corpo da mensagem (recurso_123.rar, edital.pdf…).
const RE_ARQUIVO = /\b[\w.\-]+\.(?:pdf|docx?|xlsx?|zip|rar|7z|png|jpe?g|p7s|txt|csv)\b/gi

/**
 * Tirar acento pode mudar o TAMANHO da string, então para mapear a posição de volta
 * ao texto original normalizamos caractere por caractere guardando o índice de origem.
 *
 * Usa `stripAccents` + `toLowerCase` de propósito, NÃO `normalizeText`: aquela faz
 * `.trim()`, o que apagaria os espaços aqui e quebraria tanto o mapa de posições
 * quanto as chaves de várias palavras ("recurso administrativo").
 */
function normalizarComMapa(texto: string): { norm: string; mapa: number[] } {
  let norm = ''
  const mapa: number[] = []
  for (let i = 0; i < texto.length; i++) {
    const n = stripAccents(texto[i]).toLowerCase()
    for (let k = 0; k < n.length; k++) { norm += n[k]; mapa.push(i) }
  }
  return { norm, mapa }
}

interface Marca { ini: number; fim: number; tipo: TipoDestaque }

/** Marca todas as ocorrências de `agulha` (já normalizada) no texto normalizado. */
function acharTodas(norm: string, mapa: number[], agulha: string, tipo: TipoDestaque, fora: Marca[]) {
  if (agulha.length < 2) return
  let de = 0
  for (;;) {
    const i = norm.indexOf(agulha, de)
    if (i < 0) break
    const ini = mapa[i]
    const fim = (mapa[i + agulha.length - 1] ?? ini) + 1
    fora.push({ ini, fim, tipo })
    de = i + agulha.length
  }
}

/**
 * Fatia o texto em trechos marcados/não marcados, pronto para renderizar.
 * `chaves` são as palavras-chave monitoradas do usuário (texto cru; normalizamos aqui).
 * Sobreposições são resolvidas pela marca que começa antes (e, em empate, pela maior).
 */
export function destacar(texto: string, chaves: string[]): Trecho[] {
  if (!texto) return []
  const { norm, mapa } = normalizarComMapa(texto)
  const marcas: Marca[] = []

  for (const c of chaves) {
    const n = normalizeText(c ?? '').trim()
    if (n.length >= 2) acharTodas(norm, mapa, n, 'chave', marcas)
  }
  for (const a of ANEXO_TERMOS) acharTodas(norm, mapa, normalizeText(a), 'anexo', marcas)

  // Nomes de arquivo: casam no texto ORIGINAL (extensões não têm acento).
  for (const m of texto.matchAll(RE_ARQUIVO)) {
    if (m.index != null) marcas.push({ ini: m.index, fim: m.index + m[0].length, tipo: 'anexo' })
  }

  if (marcas.length === 0) return [{ texto, tipo: null }]

  marcas.sort((a, b) => a.ini - b.ini || b.fim - a.fim)
  const trechos: Trecho[] = []
  let cursor = 0
  for (const m of marcas) {
    if (m.ini < cursor) continue                 // sobreposta: já coberta
    if (m.ini > cursor) trechos.push({ texto: texto.slice(cursor, m.ini), tipo: null })
    trechos.push({ texto: texto.slice(m.ini, m.fim), tipo: m.tipo })
    cursor = m.fim
  }
  if (cursor < texto.length) trechos.push({ texto: texto.slice(cursor), tipo: null })
  return trechos
}

/** true se alguma palavra-chave monitorada aparece no texto (filtro "somente palavra-chave"). */
export function temChave(texto: string, chaves: string[]): boolean {
  const hay = normalizeText(texto)
  return chaves.some((c) => {
    const n = normalizeText(c ?? '').trim()
    return n.length >= 2 && hay.includes(n)
  })
}
