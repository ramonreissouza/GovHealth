// src/app/api/radar/mensagens/route.ts — ações em lote sobre mensagens.
// PATCH { ids }: marca várias como lidas numa requisição só. Abrir um pregão com
// centenas de mensagens não lidas disparava um PATCH por mensagem em
// /api/radar/mensagens/[id] e estourava o rate limit do middleware (150/min por IP).

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'

const MAX_IDS = 2000

export async function PATCH(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { ids?: unknown }
  try { body = await req.json() } catch { body = {} }
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number).filter(Number.isSafeInteger))] : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids obrigatório' }, { status: 400 })
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `no máximo ${MAX_IDS} ids por requisição` }, { status: 400 })

  // Só as mensagens do titular; as demais são ignoradas em silêncio.
  const marcadas = await query<{ id: string }>(
    `UPDATE radar_mensagens SET lida = true, lida_por = $3, lida_em = now()
      WHERE id = ANY($1::bigint[]) AND titular_id = $2
      RETURNING id`,
    [ids, t.titularId, t.userId],
  )
  const idsMarcados = marcadas.map((m) => String(m.id))
  if (idsMarcados.length === 0) return NextResponse.json({ ok: true, marcadas: 0 })

  await query(
    `UPDATE radar_notificacoes SET confirmado_em = now(), status = 'entregue'
      WHERE mensagem_id = ANY($1::bigint[]) AND titular_id = $2 AND confirmado_em IS NULL`,
    [idsMarcados, t.titularId],
  )
  await query(
    `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id)
     SELECT $1, $2, 'leitura', 'radar_mensagens', unnest($3::text[])`,
    [t.titularId, t.userId, idsMarcados],
  )
  return NextResponse.json({ ok: true, marcadas: idsMarcados.length })
}
