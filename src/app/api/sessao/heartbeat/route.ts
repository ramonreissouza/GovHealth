// src/app/api/sessao/heartbeat/route.ts
// Mantém a sessão "viva" (sessão única). Retorna ok:false se esta sessão já foi
// superada — o cliente pode então deslogar.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { FLAG_SESSAO_UNICA, tocarSessao } from '@/lib/seguranca'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = token?.id as string | undefined
  const sid = token?.sessaoId as string | undefined
  if (!id || !sid) return NextResponse.json({ ok: false }, { status: 401 })
  const atual = await tocarSessao(id, sid)
  // `iniciarSessao` roda em TODO login, mesmo com a trava desligada — então o
  // sessao_id do banco passa a ser o da máquina mais recente e o token das outras
  // deixa de bater. Sem checar a flag aqui, o 2o login derrubava o 1o ("sua sessão
  // foi encerrada") mesmo com AUTH_SESSAO_UNICA off — o que quebra justamente o
  // plano Empresa, onde vários usuários dividem a conta. Com a trava off o
  // heartbeat só mantém o "último visto" vivo; nunca desloga.
  return NextResponse.json({ ok: FLAG_SESSAO_UNICA ? atual : true })
}
