// src/app/api/cron/alertas-email/route.ts — casca HTTP para disparo manual/debug.
//
// O agendamento de verdade não é mais este cron da Vercel: é o worker pg-boss
// (src/worker/index.ts), que roda a mesma lógica em src/jobs/alertasEmail.ts
// direto, sem passar por HTTP. Esta rota fica só para acionar a rodada manualmente
// (curl com o CRON_SECRET) e para inspecionar o comportamento em produção.

import { NextRequest, NextResponse } from 'next/server'
import { runAlertasEmail } from '@/jobs/alertasEmail'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const resultado = await runAlertasEmail()
    return NextResponse.json(resultado)
  } catch (error) {
    console.error('[cron:alertas-email]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
