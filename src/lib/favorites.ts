// src/lib/favorites.ts — Órgãos favoritos (item #9 do TOP10 v2).
// O vendedor marca os órgãos que acompanha; a plataforma usa isso para ordenar o
// dashboard (favoritos sobem ao topo) — "usar o perfil para ordenar". Persistência
// em localStorage no mesmo padrão de saved-views.ts / crm.ts.

import { normalizeText } from '@/lib/text'

const STORAGE_KEY = 'govhealth:favorite-orgaos'

// Chave estável por nome do órgão (normalizada — dados do governo variam acento/caixa).
function chave(nome: string): string {
  return normalizeText(nome).trim()
}

export function getFavoriteOrgaos(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function isFavoriteOrgao(nome: string | undefined | null): boolean {
  if (!nome) return false
  return getFavoriteOrgaos().includes(chave(nome))
}

/** Alterna o favorito e retorna a lista atualizada de chaves. */
export function toggleFavoriteOrgao(nome: string): string[] {
  const k = chave(nome)
  const atuais = getFavoriteOrgaos()
  const novos = atuais.includes(k) ? atuais.filter((x) => x !== k) : [k, ...atuais]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(novos))
  return novos
}
