// src/app/api/radar/conectores/route.ts — estado de saúde dos conectores do tenant.
// Requisito 4.2: expõe verificado_em (última verificação OK) separado de tentado_em.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const rows = await query(
    `SELECT s.credencial_id, s.conector_id, c.cnpj, s.status, s.verificado_em, s.tentado_em, s.detalhe, s.duracao_ms
       FROM radar_saude s LEFT JOIN radar_credenciais c ON c.id = s.credencial_id
      WHERE s.titular_id = $1
      ORDER BY c.cnpj`,
    [t.titularId],
  )
  return NextResponse.json({ conectores: rows })
}
