// src/app/api/radar/credenciais/[id]/route.ts — conectar/desconectar uma credencial.
// PATCH { acao: 'conectar' } → ENFILEIRA a conexão (conexao_status='pendente'); o
// serviço de conexão (scripts/radar/connect-service.mjs) abre o gov.br e conclui.
// PATCH { acao: 'desconectar' } → apaga a sessão capturada. Isolado por titular_id.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const { id } = await ctx.params
  let body: { acao?: 'conectar' | 'desconectar' }
  try { body = await req.json() } catch { body = {} }

  const cred = await queryOne<{ id: string }>(
    `SELECT id FROM radar_credenciais WHERE id = $1 AND titular_id = $2`, [id, t.titularId],
  )
  if (!cred) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })

  if (body.acao === 'desconectar') {
    await query(
      `UPDATE radar_credenciais SET storage_state = NULL, conexao_status = 'idle', conexao_detalhe = NULL, atualizado_em = now()
        WHERE id = $1 AND titular_id = $2`, [id, t.titularId],
    )
    await query(
      `UPDATE radar_saude SET status = 'nunca_verificado', verificado_em = NULL, detalhe = NULL, atualizado_em = now()
        WHERE credencial_id = $1`, [id],
    )
    await query(`INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id)
      VALUES ($1,$2,'cred_desconectada','radar_credenciais',$3)`, [t.titularId, t.userId, id])
    return NextResponse.json({ ok: true })
  }

  // conectar (padrão): enfileira para o serviço de conexão processar.
  await query(
    `UPDATE radar_credenciais SET conexao_status = 'pendente', conexao_pedido_em = now(), conexao_detalhe = NULL, atualizado_em = now()
      WHERE id = $1 AND titular_id = $2`, [id, t.titularId],
  )
  await query(`INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id)
    VALUES ($1,$2,'cred_conectar_pedido','radar_credenciais',$3)`, [t.titularId, t.userId, id])
  return NextResponse.json({ ok: true, conexao: 'pendente' })
}
