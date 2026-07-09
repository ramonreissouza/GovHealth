// src/app/api/senha/solicitar/route.ts — "esqueci minha senha" (pedido).
// POST { email } → envia o link de redefinição SE a conta existir. Responde sempre
// { ok: true } (anti-enumeração — não revela se o e-mail está cadastrado).
// Rota PÚBLICA; rate-limit estrito no middleware.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { solicitarResetSenha } from '@/lib/seguranca'

export const runtime = 'nodejs'

const Schema = z.object({ email: z.string().email() })

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})))
  // Mesmo com e-mail inválido, respondemos ok para não vazar informação.
  if (parsed.success) {
    try { await solicitarResetSenha(parsed.data.email) }
    catch (e) { console.error('[senha/solicitar]', e) }
  }
  return NextResponse.json({ ok: true })
}
