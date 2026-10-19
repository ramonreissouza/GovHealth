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
 * A sessão iniciada em `loginEm` (ms) deve cair? Sim se a conta foi suspensa, excluída
 * (inclui membro removido da equipe e anonimização LGPD) ou teve a senha trocada depois do
 * login. Conta que sumiu do banco também cai.
 */
export async function sessaoRevogada(id: string, loginEm: number): Promise<boolean> {
  const row = await queryOne<{ suspenso: boolean; deleted_at: string | null; senha_alterada_em: string | null }>(
    `SELECT suspenso, deleted_at, senha_alterada_em FROM usuarios WHERE id=$1`, [id.trim().toLowerCase()])
  if (!row || row.suspenso || row.deleted_at) return true
  return !!row.senha_alterada_em && new Date(row.senha_alterada_em).getTime() > loginEm
}

// Cache curto SÓ do "ainda vale": uma navegação dispara dezenas de requisições (página, RSC,
// prefetch, APIs) e todas fariam a mesma consulta. A revogação chega em até CACHE_MS; o
// "revogado" não é guardado, porque o cookie é apagado na mesma resposta.
const CACHE_MS = 5_000
const MAX_ENTRADAS = 10_000
const validas = new Map<string, number>() // `${id}|${loginEm}` → válido até (ms)

/** sessaoRevogada com o cache acima. Usar no proxy e nos guards. */
export async function sessaoRevogadaAgora(id: string, loginEm: number): Promise<boolean> {
  const chave = `${id}|${loginEm}`
  const ate = validas.get(chave)
  if (ate && ate > Date.now()) return false
  const revogada = await sessaoRevogada(id, loginEm)
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

/** O `loginEm` do token, ou 0 para token anterior à revogação (vale até a 1ª troca de senha). */
export function loginEmDo(token: object): number {
  const loginEm = (token as { loginEm?: unknown }).loginEm
  return typeof loginEm === 'number' ? loginEm : 0
}
