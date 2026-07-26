// src/lib/empresa.ts
// SETUP DA EMPRESA — fonte de verdade ÚNICA do "quem é o cliente e o que ele vende".
// Unifica o antigo Perfil & Preferências (govhealth:preferences) e o Meu Portfólio
// (govhealth:portfolio) num só objeto sincronizado por conta. Tudo que precisa do
// setup da empresa (dashboard, Radar, filtro de oportunidades, ALERTAS, preços,
// copiloto de edital) passa a derivar daqui.
//
// preferences.ts e portfolio.ts viraram VIEWS finas sobre este módulo (mantêm suas
// APIs para os consumidores existentes, mas os dados vivem todos aqui).

import type { ProdutoPortfolio } from './portfolio'
import { readLocal, writeLocal } from './synced'

const STORAGE_KEY = 'govhealth:empresa'
// Chaves legadas (migração one-shot para quem já tinha dados nos dois módulos).
const LEGACY_PREFS = 'govhealth:preferences'
const LEGACY_PORTFOLIO = 'govhealth:portfolio'

export interface EmpresaSetup {
  // ── Perfil / preferências ──
  nomeEmpresa: string
  cnpj?: string            // CNPJ do cadastro (puxado da conta no primeiro acesso)
  segmento: string
  categorias: string[]     // categorias de interesse (imagem, uti, …)
  ufs: string[]            // estados de atuação
  valorMin?: number
  valorMax?: number
  termosBusca: string[]    // termos manuais de pré-filtro
  // ── Portfólio de produtos ──
  produtos: ProdutoPortfolio[]
}

export const DEFAULT_EMPRESA: EmpresaSetup = {
  nomeEmpresa: '',
  cnpj: '',
  segmento: 'Equipamentos Médicos',
  categorias: [],
  ufs: [],
  termosBusca: [],
  produtos: [],
}

// Categorias de interesse reconhecidas no Setup (mesmo conjunto exibido na aba
// Empresa). Usadas para refletir a categoria de um produto do portfólio numa
// categoria de interesse válida.
const CATEGORIAS_SETUP = ['imagem', 'uti', 'laboratorio', 'cirurgia', 'oncologia', 'outros']

/** Mapeia a categoria de um produto do portfólio para uma categoria de interesse. */
function categoriaSetupDoProduto(cat: string): string {
  return CATEGORIAS_SETUP.includes(cat) ? cat : 'outros'
}

// Perfil legado (subconjunto de campos do preferences.ts).
interface LegacyPrefs {
  nomeEmpresa?: string
  cnpj?: string
  segmento?: string
  categorias?: string[]
  ufs?: string[]
  valorMin?: number
  valorMax?: number
  termosBusca?: string[]
}

/**
 * Migração one-shot: se ainda não existe o objeto unificado, funde os storages
 * legados (preferences + portfolio) num EmpresaSetup e persiste. Idempotente — roda
 * de novo sem duplicar, e não sobrescreve um setup já unificado.
 */
function migrarLegado(): EmpresaSetup | null {
  if (typeof window === 'undefined') return null
  const prefs = readLocal<LegacyPrefs | null>(LEGACY_PREFS, null)
  const produtos = readLocal<ProdutoPortfolio[] | null>(LEGACY_PORTFOLIO, null)
  if (!prefs && !produtos) return null
  const setup: EmpresaSetup = {
    ...DEFAULT_EMPRESA,
    ...(prefs ?? {}),
    produtos: Array.isArray(produtos) ? produtos : [],
  }
  writeLocal(STORAGE_KEY, setup)
  return setup
}

/** Lê o setup unificado (migrando do legado na primeira vez). Sempre completo. */
export function getEmpresa(): EmpresaSetup {
  const raw = readLocal<Partial<EmpresaSetup> | null>(STORAGE_KEY, null)
  if (raw) return { ...DEFAULT_EMPRESA, ...raw, produtos: raw.produtos ?? [] }
  const migrado = migrarLegado()
  return migrado ?? { ...DEFAULT_EMPRESA }
}

/** Grava um patch parcial no setup (merge com o atual) e sincroniza com a conta. */
export function saveEmpresa(patch: Partial<EmpresaSetup>): EmpresaSetup {
  const atual = getEmpresa()
  const novo: EmpresaSetup = { ...atual, ...patch }
  // Ao mexer no portfólio, reflete automaticamente as categorias dos produtos
  // ativos nas "Categorias de Interesse" (união — nunca remove as manuais). É o que
  // faz "adicionar algo ao Meu Portfólio" já atualizar a aba Empresa & Preferências.
  if (patch.produtos) {
    const cats = new Set(novo.categorias)
    for (const p of novo.produtos) {
      if (p.ativo && p.categoria) cats.add(categoriaSetupDoProduto(p.categoria))
    }
    novo.categorias = [...cats]
  }
  writeLocal(STORAGE_KEY, novo)
  return novo
}

// ── Derivados p/ quem consome o setup ─────────────────────────────────────────

/**
 * Termos de matching do setup: os termos manuais + as palavras-chave e nomes dos
 * produtos ATIVOS do portfólio. É o que alertas/pré-filtros usam para "puxar tudo
 * do setup" sem o usuário reconfigurar nada.
 */
export function termosDoSetup(e: EmpresaSetup = getEmpresa()): string[] {
  const termos = new Set<string>()
  for (const t of e.termosBusca) { const s = t.trim(); if (s) termos.add(s) }
  for (const p of e.produtos) {
    if (!p.ativo) continue
    for (const k of p.palavrasChave) { const s = k.trim(); if (s) termos.add(s) }
    if (p.nome?.trim()) termos.add(p.nome.trim())
  }
  return [...termos]
}

/** Categorias do setup: as de interesse (perfil) ∪ as dos produtos ativos. */
export function categoriasDoSetup(e: EmpresaSetup = getEmpresa()): string[] {
  const cats = new Set<string>(e.categorias)
  for (const p of e.produtos) if (p.ativo && p.categoria) cats.add(p.categoria)
  return [...cats]
}

/**
 * Forma de um monitor de alerta derivado do setup (sem id/criadoEm). O chamador
 * (página de Alertas) mapeia para createAlertaConfig. As categorias são filtradas
 * pelo chamador para o conjunto válido de AlertaCategoria.
 */
export function alertaDoSetup(e: EmpresaSetup = getEmpresa()): {
  nome: string; termos: string[]; ufs: string[]; categorias: string[]
  valorMin?: number; valorMax?: number
} {
  return {
    nome: e.nomeEmpresa ? `Setup — ${e.nomeEmpresa}` : 'Meu setup',
    termos: termosDoSetup(e),
    ufs: [...e.ufs],
    categorias: categoriasDoSetup(e),
    valorMin: e.valorMin,
    valorMax: e.valorMax,
  }
}
