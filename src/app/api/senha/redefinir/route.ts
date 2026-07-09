// src/app/api/senha/redefinir/route.ts — "esqueci minha senha" (nova senha).
// POST { email, token, novaSenha } → valida o token do e-mail e grava a nova senha.
// Rota PÚBLICA (o usuário está deslogado); token de uso único, validade 30 min.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { redefinirSenhaComToken } from '@/lib/seguranca'

export const runtime = 'nodejs'

const Schema = z.object({
  email: z.string().email(),
  token: z.string().min(1).max(400),
  novaSenha: z.string().min(1).max(200),
})

const MENSAGENS: Record<string, string> = {
  invalido: 'Link inválido. Solicite uma nova redefinição.',
  expirado: 'Este link expirou. Solicite uma nova redefinição.',
  senha_fraca: 'A senha precisa ter ao menos 8 caracteres, com letras e números.',
}

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const r = await redefinirSenhaComToken(parsed.data)
  if (!r.ok) return NextResponse.json({ error: MENSAGENS[r.erro] ?? 'Não foi possível redefinir.', erro: r.erro }, { status: 400 })
  return NextResponse.json({ ok: true })
}
