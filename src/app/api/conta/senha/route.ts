// src/app/api/conta/senha/route.ts — troca de senha do próprio usuário logado.
// POST { senhaAtual, novaSenha } → confere a atual, valida a força, grava o hash.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import { alterarSenha } from '@/lib/users'

export const runtime = 'nodejs'

const Schema = z.object({
  senhaAtual: z.string().min(1).max(200),
  novaSenha: z.string().min(1).max(200),
})

const MENSAGENS: Record<string, string> = {
  conta: 'Conta indisponível.',
  credenciais: 'A senha atual está incorreta.',
  senha_fraca: 'A nova senha precisa ter ao menos 8 caracteres, com letras e números.',
}

export async function POST(req: NextRequest) {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = ((t?.id as string | undefined) ?? (t?.sub as string | undefined))?.toLowerCase()
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 })

  const r = await alterarSenha(id, parsed.data.senhaAtual, parsed.data.novaSenha)
  if (!r.ok) return NextResponse.json({ error: MENSAGENS[r.erro] ?? 'não foi possível trocar a senha', erro: r.erro }, { status: 400 })
  return NextResponse.json({ ok: true })
}
