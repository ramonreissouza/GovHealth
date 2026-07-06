// src/app/api/auth/otp/route.ts
// Passo 1 do login: valida e-mail+senha, checa sessão única e (se 2FA ligado)
// envia o código por e-mail. O passo 2 é o signIn normal com o código.

import { NextRequest, NextResponse } from 'next/server'
import { verificarLogin } from '@/lib/users'
import { FLAG_2FA, FLAG_SESSAO_UNICA, sessaoAtiva, enviarOtp } from '@/lib/seguranca'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  let body: { email?: string; senha?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }
  const email = body.email?.trim().toLowerCase()
  const senha = body.senha?.trim()
  if (!email || !senha) return NextResponse.json({ erro: 'credenciais' }, { status: 400 })

  const { user } = await verificarLogin(email, senha)
  if (!user) return NextResponse.json({ erro: 'credenciais' }, { status: 401 })

  const isMaster = user.role === 'master'
  if (FLAG_SESSAO_UNICA && !isMaster && (await sessaoAtiva(user.id))) {
    return NextResponse.json({ erro: 'sessao_ativa' }, { status: 409 })
  }
  if (FLAG_2FA && !isMaster) {
    const enviado = await enviarOtp({ id: user.id, email: user.email, nome: user.nome })
    return NextResponse.json({ precisaOtp: true, enviado })
  }
  return NextResponse.json({ precisaOtp: false })
}
