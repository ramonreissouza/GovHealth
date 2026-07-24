// src/lib/preferences.ts
// Preferências do usuário (UFs, categorias, termos, faixa de valor). Além de
// personalizarem as telas, alimentam a SELEÇÃO AUTOMÁTICA do Radar — por isso
// sincronizam com a conta (user_data 'perfil') via lib/synced.
import { readLocal, writeLocal } from './synced'

const STORAGE_KEY = 'govhealth:preferences'

export interface UserPreferences {
  nomeEmpresa: string
  segmento: string
  categorias: string[]
  ufs: string[]
  valorMin?: number
  valorMax?: number
  termosBusca: string[]
}

const DEFAULT_PREFERENCES: UserPreferences = {
  nomeEmpresa: '',
  segmento: 'Equipamentos Médicos',
  categorias: [],
  ufs: [],
  termosBusca: [],
}

export function getPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES, ...readLocal<Partial<UserPreferences>>(STORAGE_KEY, {}) }
}

export function savePreferences(prefs: UserPreferences): void {
  // writeLocal grava no cache local e espelha no servidor (user_data 'perfil').
  writeLocal(STORAGE_KEY, prefs)
}

export function resetPreferences(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
}
