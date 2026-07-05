// src/lib/portfolio.ts
// "Meu Portfólio" — catálogo de produtos que o fornecedor vende, com vínculo a
// códigos CATMAT e palavras-chave. É a base de personalização da plataforma:
// o matching contra o portfólio filtra/destaca oportunidades pelo que a empresa
// realmente comercializa (resolve a dor nº 1 = ruído).
// Persistência em localStorage, no mesmo padrão de crm.ts / alertas.ts.

import type { CategoriaEquipamento, TipoFornecimento, Oportunidade } from './types'
import { normalizeText } from './text'

const STORAGE_KEY = 'govhealth:portfolio'

/** Vínculo com um item do catálogo CATMAT do Compras.gov. */
export interface CatmatVinculo {
  codigo: string       // codigoItemCatalogo (inteiro, como string)
  descricao: string
  pdm?: string
}

export interface ProdutoPortfolio {
  id: string
  nome: string                       // nome comercial (ex.: "Ventilador Pulmonar VG-2000")
  marca?: string
  modelo?: string
  categoria: CategoriaEquipamento
  tipoFornecimento: TipoFornecimento
  catmats: CatmatVinculo[]           // códigos CATMAT vinculados (precificação + display)
  palavrasChave: string[]            // termos que dirigem o matching textual
  registroAnvisa?: string            // gancho para o módulo C2 (monitor ANVISA)
  validadeAnvisa?: string            // ISO date — gancho C2
  ativo: boolean                     // produto inativo não participa do matching
  criadoEm: string
}

export interface PortfolioStats {
  total: number
  ativos: number
  categorias: number
  catmatsVinculados: number
}

// ── Persistência ──────────────────────────────────────────────────────────────

export function getProdutos(): ProdutoPortfolio[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveProdutos(produtos: ProdutoPortfolio[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(produtos))
}

function genId(): string {
  return `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export type ProdutoInput = Omit<ProdutoPortfolio, 'id' | 'criadoEm'>

export function createProduto(input: ProdutoInput): ProdutoPortfolio {
  const produto: ProdutoPortfolio = {
    ...input,
    id: genId(),
    criadoEm: new Date().toISOString(),
  }
  saveProdutos([produto, ...getProdutos()])
  return produto
}

export function updateProduto(id: string, patch: Partial<ProdutoPortfolio>): void {
  saveProdutos(getProdutos().map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)))
}

export function deleteProduto(id: string): void {
  saveProdutos(getProdutos().filter((p) => p.id !== id))
}

export function toggleAtivo(id: string): void {
  saveProdutos(getProdutos().map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p)))
}

// ── Matching ────────────────────────────────────────────────────────────────

/**
 * Frases-alvo de um produto (normalizadas) usadas para casar com o texto de uma
 * oportunidade. Prioriza termos explícitos (palavras-chave, nome, marca/modelo);
 * a descrição CATMAT não entra como needle por ser verbosa e gerar ruído.
 */
function needlesDoProduto(p: ProdutoPortfolio): string[] {
  const fontes = [...p.palavrasChave, p.nome, p.marca ?? '', p.modelo ?? '']
  const needles = new Set<string>()
  for (const f of fontes) {
    const n = normalizeText(f)
    if (n.length >= 3) needles.add(n)
  }
  return [...needles]
}

/** Um produto casa com um texto livre se alguma de suas frases-alvo aparece nele. */
export function produtoMatchTexto(p: ProdutoPortfolio, texto: string): boolean {
  const hay = normalizeText(texto)
  if (!hay) return false
  return needlesDoProduto(p).some((n) => hay.includes(n))
}

/** Texto pesquisável de uma oportunidade (descrição + objeto da licitação). */
function textoOportunidade(opp: Oportunidade): string {
  return `${opp.descricao} ${opp.licitacaoRelacionada?.objetoCompra ?? ''}`
}

/** Produtos ativos do portfólio que casam com a oportunidade. */
export function produtosQueCasam(
  produtos: ProdutoPortfolio[],
  opp: Oportunidade,
): ProdutoPortfolio[] {
  const texto = textoOportunidade(opp)
  return produtos.filter((p) => p.ativo && produtoMatchTexto(p, texto))
}

/** Há algum produto do portfólio que casa com a oportunidade? */
export function casaComPortfolio(produtos: ProdutoPortfolio[], opp: Oportunidade): boolean {
  if (produtos.length === 0) return false
  const texto = textoOportunidade(opp)
  return produtos.some((p) => p.ativo && produtoMatchTexto(p, texto))
}

// ── Seed de demonstração: portfólio Siemens Healthineers ──────────────────────
// Usado pela conta demo "Siemens" (Pro). Popula o portfólio (localStorage) com os
// principais produtos Siemens para exercitar o matching de oportunidades.
const SIEMENS_DEMO: ProdutoInput[] = [
  { nome: 'Ressonância Magnética MAGNETOM', marca: 'Siemens Healthineers', modelo: 'MAGNETOM Sola 1.5T', categoria: 'imagem', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['ressonancia magnetica', 'magnetom', 'ressonancia'], ativo: true },
  { nome: 'Tomógrafo Computadorizado SOMATOM', marca: 'Siemens Healthineers', modelo: 'SOMATOM go.Top', categoria: 'imagem', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['tomografo', 'tomografia computadorizada', 'somatom'], ativo: true },
  { nome: 'Ultrassom ACUSON', marca: 'Siemens Healthineers', modelo: 'ACUSON Sequoia', categoria: 'imagem', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['ultrassom', 'ultrassonografia', 'acuson'], ativo: true },
  { nome: 'Mamógrafo MAMMOMAT', marca: 'Siemens Healthineers', modelo: 'MAMMOMAT Revelation', categoria: 'imagem', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['mamografo', 'mamografia', 'mammomat'], ativo: true },
  { nome: 'Angiógrafo / Arco Cirúrgico', marca: 'Siemens Healthineers', modelo: 'ARTIS / Cios Alpha', categoria: 'imagem', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['angiografia', 'arco cirurgico', 'hemodinamica', 'artis'], ativo: true },
  { nome: 'Analisador de Imunoensaio Atellica', marca: 'Siemens Healthineers', modelo: 'Atellica IM', categoria: 'laboratorio', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['analisador', 'imunoensaio', 'bioquimica', 'atellica', 'reagente'], ativo: true },
  { nome: 'Analisador Hematológico ADVIA', marca: 'Siemens Healthineers', modelo: 'ADVIA 2120i', categoria: 'laboratorio', tipoFornecimento: 'equipamento', catmats: [], palavrasChave: ['hematologia', 'analisador hematologico', 'advia', 'hemograma'], ativo: true },
]

/** Carrega o portfólio demo da Siemens (não duplica os que já existem por nome). */
export function seedSiemensDemo(): number {
  const existentes = getProdutos()
  const jaTem = new Set(existentes.map((p) => p.nome.toLowerCase()))
  const novos = SIEMENS_DEMO
    .filter((p) => !jaTem.has(p.nome.toLowerCase()))
    .map((input) => ({ ...input, id: genId(), criadoEm: new Date().toISOString() }))
  if (novos.length) saveProdutos([...novos, ...existentes])
  return novos.length
}

export function calcularPortfolioStats(produtos: ProdutoPortfolio[]): PortfolioStats {
  const ativos = produtos.filter((p) => p.ativo)
  return {
    total: produtos.length,
    ativos: ativos.length,
    categorias: new Set(produtos.map((p) => p.categoria)).size,
    catmatsVinculados: produtos.reduce((s, p) => s + p.catmats.length, 0),
  }
}
