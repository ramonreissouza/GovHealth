// src/lib/geo/municipios.ts — lookup de coordenadas por município (server-side).
// A base municipios-br.json é gerada por scripts/geo/gen-municipios.mjs (IBGE).
// Chave: "UF|NOME_NORMALIZADO". Casa ~99,9% das licitações do PNCP.

import coords from './municipios-br.json'

const MAPA = coords as Record<string, number[]>

/** Normalização idêntica à do gerador (sem acento, maiúsc., só A-Z0-9 e espaços). */
export function normMunicipio(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Coordenada [lat, lng] do município (por UF + nome) ou null se não encontrado. */
export function coordMunicipio(uf: string, municipio: string): [number, number] | null {
  const v = MAPA[`${uf}|${normMunicipio(municipio)}`]
  return v && v.length >= 2 ? [v[0], v[1]] : null
}
