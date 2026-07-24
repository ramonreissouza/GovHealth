// src/app/api/radar/mensagens/[id]/route.ts — ações sobre uma mensagem.
// PATCH: marcar lida (confirma a notificação), atribuir responsável, escalonar.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const { id } = await ctx.params
  const msgId = Number(id)
  if (!Number.isFinite(msgId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  let body: { acao?: 'lida' | 'escalonar'; para?: string }
  try { body = await req.json() } catch { body = { acao: 'lida' } }

  const msg = await queryOne<{ id: number }>(
    `SELECT id FROM radar_mensagens WHERE id = $1 AND titular_id = $2`, [msgId, t.titularId],
  )
  if (!msg) return NextResponse.json({ error: 'não encontrada' }, { status: 404 })

  if (body.acao === 'escalonar') {
    await query(
      `UPDATE radar_notificacoes SET escalonado_em = now(), escalonado_para = $3
        WHERE mensagem_id = $1 AND titular_id = $2`,
      [msgId, t.titularId, body.para ?? null],
    )
    await query(
      `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id, detalhe)
       VALUES ($1,$2,'escalonamento','radar_mensagens',$3,$4::jsonb)`,
      [t.titularId, t.userId, String(msgId), JSON.stringify({ para: body.para })],
    )
    return NextResponse.json({ ok: true })
  }

  // Marcar lida + confirmar entrega das notificações da mensagem.
  await query(
    `UPDATE radar_mensagens SET lida = true, lida_por = $3, lida_em = now()
      WHERE id = $1 AND titular_id = $2`,
    [msgId, t.titularId, t.userId],
  )
  await query(
    `UPDATE radar_notificacoes SET confirmado_em = now(), status = 'entregue'
      WHERE mensagem_id = $1 AND titular_id = $2 AND confirmado_em IS NULL`,
    [msgId, t.titularId],
  )
  await query(
    `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id)
     VALUES ($1,$2,'leitura','radar_mensagens',$3)`,
    [t.titularId, t.userId, String(msgId)],
  )
  return NextResponse.json({ ok: true })
}
