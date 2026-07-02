// src/lib/territorio.ts — Território de atuação do vendedor (item #8 do TOP10 v2).
// Rep de saúde pensa por território, não por lista. Aqui o usuário guarda as UFs
// onde atua (ex.: "Nordeste + norte de MG") em localStorage, e as telas usam isso
// para filtrar/destacar o que é dele. Fundação reutilizável (mapa, dashboard…).

const STORAGE_KEY = 'govhealth:territorio'

export interface Regiao { key: string; label: string; ufs: string[] }

export const REGIOES: Regiao[] = [
  { key: 'norte', label: 'Norte', ufs: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'] },
  { key: 'nordeste', label: 'Nordeste', ufs: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'] },
  { key: 'centro-oeste', label: 'Centro-Oeste', ufs: ['DF', 'GO', 'MS', 'MT'] },
  { key: 'sudeste', label: 'Sudeste', ufs: ['ES', 'MG', 'RJ', 'SP'] },
  { key: 'sul', label: 'Sul', ufs: ['PR', 'RS', 'SC'] },
]

export const TODAS_UFS = REGIOES.flatMap((r) => r.ufs).sort()

export function getTerritorio(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function setTerritorio(ufs: string[]): string[] {
  const limpo = Array.from(new Set(ufs.filter((u) => TODAS_UFS.includes(u)))).sort()
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(limpo))
  return limpo
}

export function toggleUF(uf: string, atuais = getTerritorio()): string[] {
  return setTerritorio(atuais.includes(uf) ? atuais.filter((u) => u !== uf) : [...atuais, uf])
}

// Alterna uma região inteira: se todas as UFs dela já estão no território, remove-as; senão, adiciona.
export function toggleRegiao(regiao: Regiao, atuais = getTerritorio()): string[] {
  const todasDentro = regiao.ufs.every((u) => atuais.includes(u))
  return setTerritorio(todasDentro ? atuais.filter((u) => !regiao.ufs.includes(u)) : [...atuais, ...regiao.ufs])
}

export function regiaoAtiva(regiao: Regiao, atuais: string[]): 'cheia' | 'parcial' | 'vazia' {
  const dentro = regiao.ufs.filter((u) => atuais.includes(u)).length
  if (dentro === 0) return 'vazia'
  return dentro === regiao.ufs.length ? 'cheia' : 'parcial'
}
