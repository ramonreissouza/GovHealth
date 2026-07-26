// src/lib/preferences.ts
// Preferências do usuário (UFs, categorias, termos, faixa de valor). Desde a
// unificação do "Setup da Empresa", estes campos vivem em lib/empresa.ts (fonte de
// verdade única). Este módulo é uma VIEW fina sobre o setup, mantida para os
// consumidores existentes (dashboard, seleção automática do Radar, oportunidades).
import { getEmpresa, saveEmpresa, DEFAULT_EMPRESA } from './empresa'

export interface UserPreferences {
  nomeEmpresa: string
  cnpj?: string
  segmento: string
  categorias: string[]
  ufs: string[]
  valorMin?: number
  valorMax?: number
  termosBusca: string[]
}

/** Recorta os campos de perfil do setup unificado. */
export function getPreferences(): UserPreferences {
  const e = getEmpresa()
  return {
    nomeEmpresa: e.nomeEmpresa,
    cnpj: e.cnpj,
    segmento: e.segmento,
    categorias: e.categorias,
    ufs: e.ufs,
    valorMin: e.valorMin,
    valorMax: e.valorMax,
    termosBusca: e.termosBusca,
  }
}

/** Grava os campos de perfil no setup unificado (preserva o portfólio). */
export function savePreferences(prefs: UserPreferences): void {
  saveEmpresa(prefs)
}

/** Restaura os campos de perfil ao padrão (não mexe no portfólio). */
export function resetPreferences(): void {
  const { produtos: _omit, ...perfilDefault } = DEFAULT_EMPRESA
  saveEmpresa(perfilDefault)
}
