// src/lib/admin-guard.ts — checagem SERVER-SIDE de acesso master à área admin.
// Usado no middleware e em TODA rota /api/admin/*. Nunca confiar no cliente.
// Regras: role='master' no token JWT + (se ADMIN_EMAIL setado) e-mail igual +
// frescor de sessão do admin mais curto que o comum (8h).

import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { sessaoRevogadaAgora, marcaDo } from '@/lib/revogacao'

const ADMIN_SESSAO_MAX_S = 8 * 60 * 60 // 8h de frescor para o master

export interface TokenAdmin { id?: string; email?: string | null; role?: string; iat?: number; revogado?: boolean; loginEm?: number; senhaVersao?: number }

/** Retorna o token se for um master válido e "fresco"; senão null. */
export async function tokenMaster(req: NextRequest): Promise<TokenAdmin | null> {
  const token = (await getToken({ req, secret: process.env.NEXTAUTH_SECRET })) as TokenAdmin | null
  // revogado: senha trocada ou conta suspensa depois do login (callback jwt em lib/auth).
  if (!token || token.role !== 'master' || token.revogado) return null

  // Checagem redundante por env (se ADMIN_EMAIL estiver definido, exige match).
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (adminEmail && String(token.email ?? '').toLowerCase() !== adminEmail) return null

  // Sessão do admin expira mais rápido que a do usuário comum.
  if (token.iat && Date.now() / 1000 - token.iat > ADMIN_SESSAO_MAX_S) return null

  // Revogação conferida no BANCO, não só no `revogado` do token: um JWT de master capturado
  // e usado direto em /api/admin/* não passa pelo callback jwt que marcaria o campo
  // (revisão da #68). Banco indisponível nega — é a área mais sensível.
  if (!token.id) return null
  try {
    if (await sessaoRevogadaAgora(token.id, marcaDo(token))) return null
  } catch (e) {
    console.error('[admin-guard] revogação indisponível, acesso negado:', e)
    return null
  }

  return token
}

/** Guard para rotas de API: retorna { token } ou uma resposta 403/401 pronta. */
export async function exigirMaster(req: NextRequest): Promise<{ token: TokenAdmin } | { erro: NextResponse }> {
  const token = await tokenMaster(req)
  if (!token) {
    return { erro: NextResponse.json({ error: 'Acesso restrito ao administrador.' }, { status: 403 }) }
  }
  return { token }
}
