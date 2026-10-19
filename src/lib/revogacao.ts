// src/lib/revogacao.ts — SERVER-ONLY. A sessão (JWT) ainda vale, segundo o BANCO?
//
// O JWT é autocontido: suspender a conta ou trocar a senha não muda um token já emitido.
// Marcar `token.revogado` no callback jwt (lib/auth) só funciona quando o navegador renova a
// sessão; um token capturado e usado direto nas APIs nunca passa por lá (revisão da #68).
// Por isso o proxy (src/proxy.ts) e o guard do admin perguntam AQUI, a cada requisição.
//
// Módulo leve de propósito: só o db. O proxy roda em toda requisição e não deve carregar o
// users.ts (que gera um hash bcrypt ao ser importado).

import { queryOne } from '@/lib/db'

/**
 * O que o token diz sobre a senha com que foi autenticado.
 *  - `senhaVersao`: o senha_alterada_em (ms; 0 = nunca trocada) lido NA MESMA consulta que
 *    conferiu o hash (verificarLogin). A sessão vale enquanto a versão do banco for IGUAL.
 *    Comparar com o instante do login deixava uma corrida: a senha validada, depois trocada
 *    antes do callback jwt gravar o instante, gerava um token "posterior" à troca e aceito,
 *    autenticado com a senha revogada (revisão da #68).
 *  - `loginEm`: tokens emitidos antes da versão existir. Caem na primeira troca de senha
 *    depois do login; somem sozinhos em até 7 dias (maxAge da sessão).
 */
export interface MarcaSessao { senhaVersao?: number; loginEm: number }

/** Versão da senha: o instante da última troca, em ms (0 = nunca trocada). */
export function versaoSenha(senhaAlteradaEm: string | Date | null | undefined): number {
  return senhaAlteradaEm ? new Date(senhaAlteradaEm).getTime() : 0
}

/** A marca de sessão de um token (JWT decifrado). */
export function marcaDo(token: object): MarcaSessao {
  const t = token as { senhaVersao?: unknown; loginEm?: unknown }
  return {
    senhaVersao: typeof t.senhaVersao === 'number' ? t.senhaVersao : undefined,
    loginEm: typeof t.loginEm === 'number' ? t.loginEm : 0,
  }
}

/**
 * A sessão deve cair? Sim se a conta foi suspensa, excluída (inclui membro removido da
 * equipe e anonimização LGPD), sumiu do banco ou teve a senha trocada (ver MarcaSessao).
 */
export async function sessaoRevogada(id: string, marca: MarcaSessao): Promise<boolean> {
  const row = await queryOne<{ suspenso: boolean; deleted_at: string | null; senha_alterada_em: string | null }>(
    `SELECT suspenso, deleted_at, senha_alterada_em FROM usuarios WHERE id=$1`, [id.trim().toLowerCase()])
  if (!row || row.suspenso || row.deleted_at) return true
  const atual = versaoSenha(row.senha_alterada_em)
  if (marca.senhaVersao !== undefined) return atual !== marca.senhaVersao
  return atual !== 0 && atual > marca.loginEm // token legado
}

// Cache curto SÓ do "ainda vale": uma navegação dispara dezenas de requisições (página, RSC,
// prefetch, APIs) e todas fariam a mesma consulta. A revogação chega em até CACHE_MS; o
// "revogado" não é guardado, porque o cookie é apagado na mesma resposta.
const CACHE_MS = 5_000
const MAX_ENTRADAS = 10_000
const validas = new Map<string, number>() // `${id}|${marca}` → válido até (ms)

/** sessaoRevogada com o cache acima. Usar no proxy e nos guards. */
export async function sessaoRevogadaAgora(id: string, marca: MarcaSessao): Promise<boolean> {
  const chave = `${id}|${marca.senhaVersao ?? `l${marca.loginEm}`}`
  const ate = validas.get(chave)
  if (ate && ate > Date.now()) return false
  const revogada = await sessaoRevogada(id, marca)
  if (revogada) validas.delete(chave)
  else {
    if (validas.size >= MAX_ENTRADAS) validas.clear()
    validas.set(chave, Date.now() + CACHE_MS)
  }
  return revogada
}

/** Testes: esquece o cache (sem esperar CACHE_MS entre "revogar" e "conferir"). */
export function limparCacheRevogacao(): void {
  validas.clear()
}
