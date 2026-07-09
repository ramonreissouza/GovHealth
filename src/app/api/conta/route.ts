// src/app/api/conta/route.ts — dados da conta do próprio usuário logado.
// GET   → resumo da conta (plano, status, faturamento, se há pagamento vinculado).
// PATCH → atualiza os dados cadastrais/de faturamento (nunca plano/status/senha).

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { z } from 'zod'
import { contaResumo, atualizarUsuario } from '@/lib/users'

export const runtime = 'nodejs'

async function uid(req: NextRequest): Promise<string | null> {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = (t?.id as string | undefined) ?? (t?.sub as string | undefined)
  return id ? id.toLowerCase() : null
}

export async function GET(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const conta = await contaResumo(id)
  if (!conta) return NextResponse.json({ error: 'conta não encontrada' }, { status: 404 })
  return NextResponse.json({ conta })
}

// Só campos cadastrais/de faturamento — plano, status e senha têm fluxos próprios.
const Patch = z.object({
  nome: z.string().max(120).optional(),
  empresa: z.string().max(160).optional(),
  telefone: z.string().max(40).optional(),
  instituicao: z.string().max(160).optional(),
  endereco: z.string().max(240).optional(),
  cpf: z.string().max(20).optional(),
  cnpj: z.string().max(20).optional(),
})

export async function PATCH(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const parsed = Patch.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'dados inválidos' }, { status: 400 })

  // '' → null (limpa o campo); undefined é ignorado por atualizarUsuario.
  const patch: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue
    patch[k] = v.trim() === '' ? null : v.trim()
  }
  await atualizarUsuario(id, patch)
  const conta = await contaResumo(id)
  return NextResponse.json({ ok: true, conta })
}
