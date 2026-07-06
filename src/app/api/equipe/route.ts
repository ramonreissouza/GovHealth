// src/app/api/equipe/route.ts
// GET  → dados da equipe do usuário logado (assentos, membros, convites, vagas).
// POST → convida um e-mail (titular), envia o link de aceite. Respeita o limite.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { equipeInfo, criarConvite } from '@/lib/users'
import { enviarConviteEquipe } from '@/lib/email'

export const runtime = 'nodejs'

async function uid(req: NextRequest): Promise<string | null> {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = (t?.id as string | undefined) ?? (t?.sub as string | undefined)
  return id ? id.toLowerCase() : null
}

export async function GET(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  return NextResponse.json(await equipeInfo(id))
}

export async function POST(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }
  const r = await criarConvite({ userId: id, email: (body.email ?? '').trim() })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const link = `${base}/aceitar-convite?token=${r.token}`
  const info = await equipeInfo(id)
  const empresa = info.membros.find((m) => m.id === info.titularId)?.empresa ?? null
  await enviarConviteEquipe({ to: r.email, empresa, link })
  return NextResponse.json({ ok: true, email: r.email })
}
