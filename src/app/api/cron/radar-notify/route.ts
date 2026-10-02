// src/app/api/cron/radar-notify/route.ts — casca HTTP para disparo manual/debug.
//
// Quem agenda de verdade é o worker pg-boss (src/worker/index.ts, a cada 5 min), que
// roda a mesma lógica em src/jobs/radarNotify.ts sem passar por HTTP. Esta rota fica
// para acionar uma rodada à mão (curl com o CRON_SECRET). Rodar junto com o worker é
// seguro: cada linha é reivindicada antes do envio.

import { NextRequest, NextResponse } from 'next/server'
import { runRadarNotify } from '@/jobs/radarNotify'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runRadarNotify())
  } catch (e) {
    console.error('[cron/radar-notify]', e)
    return NextResponse.json({ error: 'Erro ao processar notificações do Radar' }, { status: 500 })
  }
}
