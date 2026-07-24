// src/app/api/radar/processos/route.ts — processos monitorados (auto-selecionados).
// GET: lista (com motivo_match). PATCH: fixar/silenciar/atribuir/prioridade.
// POST/DELETE: exceções manuais. Isolado por titular_id.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const rows = await query(
    `SELECT id, conector_id, cnpj, licitacao_id, titulo, uf, valor, responsavel, prioridade,
            status, origem, mutado, motivo_match, link_portal, atualizado_em
       FROM radar_processos
      WHERE titular_id = $1
      ORDER BY (prioridade = 'alta') DESC, atualizado_em DESC
      LIMIT 1000`,
    [t.titularId],
  )
  return NextResponse.json({ processos: rows })
}

export async function PATCH(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { id?: string; mutado?: boolean; prioridade?: string; responsavel?: string; status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const sets: string[] = []
  const params: unknown[] = [body.id, t.titularId]
  if (body.mutado != null) { params.push(body.mutado); sets.push(`mutado = $${params.length}`) }
  if (body.prioridade) { params.push(body.prioridade); sets.push(`prioridade = $${params.length}`) }
  if (body.responsavel !== undefined) { params.push(body.responsavel || null); sets.push(`responsavel = $${params.length}`) }
  if (body.status) { params.push(body.status); sets.push(`status = $${params.length}`) }
  if (!sets.length) return NextResponse.json({ error: 'nada a atualizar' }, { status: 400 })

  const row = await queryOne<{ id: string }>(
    `UPDATE radar_processos SET ${sets.join(', ')}, atualizado_em = now()
      WHERE id = $1 AND titular_id = $2 RETURNING id`,
    params,
  )
  if (!row) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { conectorId?: string; cnpj?: string; licitacaoId?: string; titulo?: string; linkPortal?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const cnpj = (body.cnpj ?? '').replace(/\D+/g, '')
  const licitacaoId = (body.licitacaoId ?? '').trim()
  if (!licitacaoId) return NextResponse.json({ error: 'licitacaoId obrigatório' }, { status: 400 })
  const id = randomUUID()
  await query(
    `INSERT INTO radar_processos (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, origem, link_portal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8)
     ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE SET atualizado_em = now()`,
    [id, t.titularId, t.userId, body.conectorId ?? 'comprasgov', cnpj, licitacaoId, body.titulo ?? null, body.linkPortal ?? null],
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  await query(`DELETE FROM radar_processos WHERE id = $1 AND titular_id = $2 AND origem = 'manual'`, [id, t.titularId])
  return NextResponse.json({ ok: true })
}
