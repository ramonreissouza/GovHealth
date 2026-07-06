// src/app/api/equipe/route.ts
// GET    → dados da equipe do usuário logado (assentos, membros, convites c/ link, vagas).
// POST   → convida um e-mail (titular): gera o link de aceite e tenta enviar por e-mail.
// DELETE → remove um membro (soft-delete) ou cancela um convite pendente (só titular).

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { equipeInfo, criarConvite, removerMembro, cancelarConvite } from '@/lib/users'
import { enviarConviteEquipe } from '@/lib/email'

export const runtime = 'nodejs'

async function uid(req: NextRequest): Promise<string | null> {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = (t?.id as string | undefined) ?? (t?.sub as string | undefined)
  return id ? id.toLowerCase() : null
}

function linkConvite(req: NextRequest, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  return `${base}/aceitar-convite?token=${token}`
}

export async function GET(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const info = await equipeInfo(id)
  // Enriquece cada convite pendente com o link de aceite (para copiar/reenviar).
  const convitesPendentes = info.convitesPendentes.map((c) => ({
    id: c.id, email: c.email, expira_em: c.expira_em, link: linkConvite(req, c.token),
  }))
  return NextResponse.json({ ...info, convitesPendentes })
}

export async function POST(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }
  const r = await criarConvite({ userId: id, email: (body.email ?? '').trim() })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })

  const link = linkConvite(req, r.token)
  const info = await equipeInfo(id)
  const empresa = info.membros.find((m) => m.id === info.titularId)?.empresa ?? null
  const envio = await enviarConviteEquipe({ to: r.email, empresa, link })
  return NextResponse.json({ ok: true, email: r.email, link, enviado: envio.enviado })
}

export async function DELETE(req: NextRequest) {
  const id = await uid(req)
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  // Só o titular pode remover membros/convites.
  const info = await equipeInfo(id)
  if (!info.souTitular) return NextResponse.json({ erro: 'sem_permissao' }, { status: 403 })
  let body: { membroId?: string; conviteId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }

  if (body.membroId) {
    const r = await removerMembro({ titularId: id, membroId: body.membroId })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })
    return NextResponse.json({ ok: true })
  }
  if (body.conviteId) {
    const r = await cancelarConvite({ titularId: id, conviteId: body.conviteId })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ erro: 'nada_a_remover' }, { status: 400 })
}
