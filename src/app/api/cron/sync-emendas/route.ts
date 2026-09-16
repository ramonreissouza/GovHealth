// src/app/api/cron/sync-emendas/route.ts — casca HTTP para disparo manual/debug.
//
// O agendamento de verdade não é mais este cron da Vercel: é o worker pg-boss
// (src/worker/index.ts), que roda a mesma lógica em src/jobs/syncEmendas.ts direto,
// sem passar por HTTP. Esta rota fica só para acionar a rodada manualmente
// (curl com o CRON_SECRET) e para inspecionar o comportamento em produção.

import { NextRequest, NextResponse } from 'next/server'
import { runSyncEmendas } from '@/jobs/syncEmendas'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const resultado = await runSyncEmendas()
    return NextResponse.json(resultado)
  } catch (error) {
    console.error('[cron:sync-emendas]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
