// src/lib/radar/db.ts — helpers de acesso ao Radar no servidor.
// Deriva o TENANT (titular_id) do token — nunca de parâmetro do client — para
// isolar os dados por empresa. Reusa resolverTitular de lib/users.

import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { resolverTitular } from '@/lib/users'

export interface Tenant {
  userId: string        // usuarios.id (e-mail minúsculo) de quem está logado
  titularId: string     // empresa dona dos dados (isolamento)
  email: string         // e-mail para notificações (o próprio id)
}

/** Resolve o tenant do request autenticado, ou null se não logado. */
export async function tenantDe(req: NextRequest): Promise<Tenant | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = ((token?.id as string | undefined) ?? (token?.sub as string | undefined))?.toLowerCase()
  if (!id) return null
  const titularId = await resolverTitular(id)
  const email = (token?.email as string | undefined)?.toLowerCase() ?? id
  return { userId: id, titularId, email }
}
