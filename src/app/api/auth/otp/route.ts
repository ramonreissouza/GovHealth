// src/app/api/auth/otp/route.ts
// Passo 1 do login: valida e-mail+senha, checa sessão única e (se 2FA ligado)
// envia o código por e-mail. O passo 2 é o signIn normal com o código.
// Chamado de novo pelo botão "Reenviar código" (com intervalo mínimo, ver enviarOtp).

import { NextRequest, NextResponse } from 'next/server'
import { verificarLogin } from '@/lib/users'
import { FLAG_2FA, FLAG_SESSAO_UNICA, sessaoAtiva, enviarOtp, loginContaLiberado } from '@/lib/seguranca'
import { COOKIE_DISPOSITIVO, dispositivoConfiavel } from '@/lib/dispositivo-confiavel'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  let body: { email?: string; senha?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }
  const email = body.email?.trim().toLowerCase()
  const senha = body.senha?.trim()
  if (!email || !senha) return NextResponse.json({ erro: 'credenciais' }, { status: 400 })

  // Antes da senha: a conta não pode ser testada sem limite trocando de IP.
  if (!(await loginContaLiberado(email))) return NextResponse.json({ erro: 'bloqueado' }, { status: 429 })

  const { user } = await verificarLogin(email, senha)
  if (!user) return NextResponse.json({ erro: 'credenciais' }, { status: 401 })

  const isMaster = user.role === 'master'
  if (FLAG_SESSAO_UNICA && !isMaster && (await sessaoAtiva(user.id))) {
    return NextResponse.json({ erro: 'sessao_ativa' }, { status: 409 })
  }
  if (FLAG_2FA && !isMaster) {
    // Navegador já confirmado com código nos últimos DISPOSITIVO_DIAS: entra sem código.
    if (dispositivoConfiavel(req.cookies.get(COOKIE_DISPOSITIVO)?.value, user.id, user.senha_alterada_em)) {
      return NextResponse.json({ precisaOtp: false })
    }
    const r = await enviarOtp({ id: user.id, email: user.email, nome: user.nome })
    switch (r.status) {
      case 'enviado':
      case 'so_no_console':
        return NextResponse.json({ precisaOtp: true, enviado: r.status === 'enviado', aguardeSeg: null })
      case 'aguarde': // o código enviado há pouco continua valendo: segue para a etapa do código
        return NextResponse.json({ precisaOtp: true, enviado: false, aguardeSeg: r.segundos })
      case 'bloqueado': // 5 erros no código atual: nada de código novo até ele vencer
        return NextResponse.json({ erro: 'otp_bloqueado', aguardeSeg: r.segundos }, { status: 429 })
      case 'falhou': // a tela fica na etapa de senha; pode tentar de novo na hora
        return NextResponse.json({ erro: 'envio_falhou' }, { status: 503 })
    }
  }
  return NextResponse.json({ precisaOtp: false })
}
