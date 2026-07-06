// src/app/api/sessao/heartbeat/route.ts
// Mantém a sessão "viva" (sessão única). Retorna ok:false se esta sessão já foi
// superada — o cliente pode então deslogar.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { tocarSessao } from '@/lib/seguranca'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = token?.id as string | undefined
  const sid = token?.sessaoId as string | undefined
  if (!id || !sid) return NextResponse.json({ ok: false }, { status: 401 })
  const atual = await tocarSessao(id, sid)
  return NextResponse.json({ ok: atual })
}
