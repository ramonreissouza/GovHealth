// src/app/api/user-data/route.ts
// Persistência por conta (substitui o localStorage) dos módulos do fornecedor:
// portfólio, CRM, alertas, agenda. GET ?chave=... lê; PUT { chave, valor } grava.
// Sempre vinculado ao usuário logado (getToken) — nunca a outro.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { query, queryOne } from '@/lib/db'

export const runtime = 'nodejs'

// Chaves permitidas (evita virar um KV genérico/abusável).
// 'empresa' = Setup da Empresa unificado (perfil + portfólio), fonte de verdade única;
// precisa viver na conta porque o Radar seleciona processos no SERVIDOR a partir dele.
// 'perfil'/'portfolio' são legados mantidos p/ hidratação/migração de dados antigos.
const CHAVES = new Set(['empresa', 'portfolio', 'crm', 'alertas-config', 'alertas-notif', 'agenda', 'perfil'])

async function userId(req: NextRequest): Promise<string | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = (token?.id as string | undefined) ?? (token?.sub as string | undefined)
  return id ? id.toLowerCase() : null
}

export async function GET(req: NextRequest) {
  const uid = await userId(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const chave = req.nextUrl.searchParams.get('chave') ?? ''
  if (!CHAVES.has(chave)) return NextResponse.json({ error: 'chave inválida' }, { status: 400 })
  const row = await queryOne<{ valor: unknown }>(
    `SELECT valor FROM user_data WHERE user_id = $1 AND chave = $2`, [uid, chave],
  )
  return NextResponse.json({ valor: row?.valor ?? null })
}

export async function PUT(req: NextRequest) {
  const uid = await userId(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { chave?: string; valor?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const chave = body.chave ?? ''
  if (!CHAVES.has(chave)) return NextResponse.json({ error: 'chave inválida' }, { status: 400 })
  await query(
    `INSERT INTO user_data (user_id, chave, valor, atualizado_em)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id, chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
    [uid, chave, JSON.stringify(body.valor ?? null)],
  )
  return NextResponse.json({ ok: true })
}
