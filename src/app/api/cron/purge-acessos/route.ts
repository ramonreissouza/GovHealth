// src/app/api/cron/purge-acessos/route.ts — expurgo LGPD: remove acessos > 90 dias.
// Protegido pelo CRON_SECRET (igual sync-pncp). Agendar no vercel.json.
import { NextRequest, NextResponse } from 'next/server'
import { expurgarAcessosAntigos } from '@/lib/acessos'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const removidos = await expurgarAcessosAntigos(90)
    return NextResponse.json({ ok: true, removidos })
  } catch (e) {
    console.error('[cron/purge-acessos]', e)
    return NextResponse.json({ error: 'Erro no expurgo' }, { status: 500 })
  }
}
