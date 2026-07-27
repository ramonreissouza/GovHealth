// src/lib/onboarding.ts
// Sinal de "primeiro acesso" do cliente. No 1º login, a primeira tela é o Setup da
// Empresa (escolher estados, produtos, etc.); a partir do 2º login, o Dashboard já
// abre direto e filtrado pelo setup salvo.
//
// O flag vive na CONTA (sincronizado via lib/synced, chave 'onboarded'), então vale
// entre máquinas e independe do caminho de login (cadastro, Google, conta de demo).
// Contas antigas que JÁ configuraram o setup (UFs ou produtos) são tratadas como
// onboarded — assim quem já usa o produto não é jogado no setup de novo.

import { readLocal, writeLocal } from './synced'
import { getEmpresa } from './empresa'

const KEY = 'govhealth:onboarded'

/** true quando o cliente já concluiu o setup inicial (explicitamente ou por já ter dados). */
export function isOnboarded(): boolean {
  if (typeof window === 'undefined') return true // no SSR não redireciona
  if (readLocal<boolean>(KEY, false)) return true
  // Migração p/ contas existentes: quem já tem UFs ou produtos configurados já passou
  // do setup — não força onboarding de novo (nomeEmpresa/CNPJ não contam: são puxados
  // automaticamente do cadastro e não indicam configuração deliberada).
  const e = getEmpresa()
  return e.ufs.length > 0 || e.produtos.length > 0
}

/** Marca o setup inicial como concluído (ao salvar o Setup da Empresa). */
export function markOnboarded(): void {
  writeLocal(KEY, true)
}
