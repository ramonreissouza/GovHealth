// src/app/api/ia/conversas/[id]/route.ts — uma conversa.
// GET    → mensagens (para reabrir a conversa)
// PATCH  { titulo? , mensagens? } → renomeia e/ou ACRESCENTA mensagens novas
// DELETE → apaga (as mensagens caem por ON DELETE CASCADE)
//
// Toda query filtra por user_id junto do id: sem isso, um id vazado leria a conversa
// de outra conta.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { userIdDe, tituloDe } from '../route'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

async function minha(uid: string, id: string) {
  return queryOne<{ id: string; titulo: string; tipo: string }>(
    `SELECT id, titulo, tipo FROM ia_conversas WHERE id = $1 AND user_id = $2`, [id, uid])
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const uid = await userIdDe(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const { id } = await ctx.params
  const conv = await minha(uid, id)
  if (!conv) return NextResponse.json({ error: 'não encontrada' }, { status: 404 })

  const mensagens = await query<{ id: number; papel: string; conteudo: string; dados: unknown; criado_em: string }>(
    `SELECT id, papel, conteudo, dados, criado_em FROM ia_mensagens
      WHERE conversa_id = $1 ORDER BY id`, [id])
  return NextResponse.json({ conversa: conv, mensagens })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const uid = await userIdDe(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const { id } = await ctx.params
  const conv = await minha(uid, id)
  if (!conv) return NextResponse.json({ error: 'não encontrada' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const novas: Array<{ papel: string; conteudo?: string; dados?: unknown }> =
    Array.isArray(body?.mensagens) ? body.mensagens : []
  for (const m of novas) {
    await query(
      `INSERT INTO ia_mensagens (conversa_id, papel, conteudo, dados) VALUES ($1,$2,$3,$4::jsonb)`,
      [id, m.papel === 'assistant' ? 'assistant' : 'user', m.conteudo ?? '',
       m.dados == null ? null : JSON.stringify(m.dados)],
    )
  }
  const titulo = typeof body?.titulo === 'string' ? tituloDe(body.titulo) : null
  // `atualizado_em` sobe sempre que a conversa recebe algo — é a ordem da lista.
  await query(
    `UPDATE ia_conversas SET titulo = COALESCE($2, titulo), atualizado_em = now() WHERE id = $1`,
    [id, titulo],
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const uid = await userIdDe(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const { id } = await ctx.params
  const r = await query(`DELETE FROM ia_conversas WHERE id = $1 AND user_id = $2 RETURNING id`, [id, uid])
  if (!r.length) return NextResponse.json({ error: 'não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
