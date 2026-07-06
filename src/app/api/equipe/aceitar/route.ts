// src/app/api/equipe/aceitar/route.ts — PÚBLICO (o convidado ainda não tem conta).
// GET ?token → dados do convite (e-mail/empresa). POST → cria o membro (senha própria).

import { NextRequest, NextResponse } from 'next/server'
import { buscarConvite, aceitarConvite } from '@/lib/users'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const c = await buscarConvite(token)
  if (!c) return NextResponse.json({ erro: 'invalido' }, { status: 404 })
  return NextResponse.json(c)
}

export async function POST(req: NextRequest) {
  let body: { token?: string; senha?: string; nome?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }
  const r = await aceitarConvite({ token: body.token ?? '', senha: body.senha ?? '', nome: body.nome ?? '' })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })
  return NextResponse.json({ ok: true, email: r.email })
}
