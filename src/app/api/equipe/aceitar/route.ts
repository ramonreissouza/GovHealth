// src/app/api/equipe/aceitar/route.ts — PÚBLICO (o convidado ainda não tem conta).
// GET ?token → dados do convite (e-mail/empresa). POST → cria o membro (senha própria).

import { NextRequest, NextResponse } from 'next/server'
import { buscarConvite, aceitarConvite } from '@/lib/users'
import { ipDaRequisicao } from '@/lib/assinaturas'
import { TERMOS_VERSAO, PRIVACIDADE_VERSAO } from '@/lib/empresa-legal'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const c = await buscarConvite(token)
  if (!c) return NextResponse.json({ erro: 'invalido' }, { status: 404 })
  return NextResponse.json(c)
}

export async function POST(req: NextRequest) {
  let body: { token?: string; senha?: string; nome?: string; termosVersao?: string; privacidadeVersao?: string }
  try { body = await req.json() } catch { return NextResponse.json({ erro: 'body' }, { status: 400 }) }
  // Cada membro aceita os Termos por si — o aceite do titular não vale pela pessoa
  // convidada. Sem aceite não há conta; aceite de versão antiga, idem (ver camposAceite).
  if (!body.termosVersao || !body.privacidadeVersao) return NextResponse.json({ erro: 'aceite' }, { status: 400 })
  if (body.termosVersao !== TERMOS_VERSAO || body.privacidadeVersao !== PRIVACIDADE_VERSAO) {
    return NextResponse.json({ erro: 'aceite_desatualizado' }, { status: 400 })
  }
  const r = await aceitarConvite({
    token: body.token ?? '', senha: body.senha ?? '', nome: body.nome ?? '',
    aceite: { termosVersao: TERMOS_VERSAO, privacidadeVersao: PRIVACIDADE_VERSAO, ip: ipDaRequisicao(req.headers) },
  })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 })
  return NextResponse.json({ ok: true, email: r.email })
}
