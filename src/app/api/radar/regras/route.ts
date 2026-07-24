// src/app/api/radar/regras/route.ts — regras de palavra-chave do usuário.
// GET: built-in globais + as do tenant. POST: cria keyword. DELETE: remove.
// As built-in (regex PT-BR) vivem em lib/radar/regras; aqui só as customizadas.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const regras = await query(
    `SELECT id, tipo, padrao, prioridade, ativo
       FROM radar_regras
      WHERE titular_id = $1 OR titular_id IS NULL
      ORDER BY (titular_id IS NULL) DESC, criado_em`,
    [t.titularId],
  )
  return NextResponse.json({ regras })
}

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { padrao?: string; prioridade?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const padrao = (body.padrao ?? '').trim()
  if (!padrao) return NextResponse.json({ error: 'padrao obrigatório' }, { status: 400 })
  const id = randomUUID()
  await query(
    `INSERT INTO radar_regras (id, titular_id, user_id, tipo, padrao, prioridade)
     VALUES ($1,$2,$3,'keyword',$4,$5)`,
    [id, t.titularId, t.userId, padrao, body.prioridade === 'alta' ? 'alta' : 'normal'],
  )
  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  // Só remove regra do próprio tenant (built-in globais têm titular_id NULL e ficam protegidas).
  const row = await queryOne<{ id: string }>(
    `DELETE FROM radar_regras WHERE id = $1 AND titular_id = $2 RETURNING id`, [id, t.titularId],
  )
  if (!row) return NextResponse.json({ error: 'não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
