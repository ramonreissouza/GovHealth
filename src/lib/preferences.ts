// src/lib/preferences.ts
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
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(prefs: UserPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function resetPreferences(): void {
  localStorage.removeItem(STORAGE_KEY)
}
