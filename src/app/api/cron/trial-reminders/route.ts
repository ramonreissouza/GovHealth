// src/app/api/cron/trial-reminders/route.ts — casca HTTP para disparo manual/debug.
//
// O agendamento de verdade não é mais este cron da Vercel: é o worker pg-boss
// (src/worker/index.ts), que roda a mesma lógica em src/jobs/trialReminders.ts
// direto, sem passar por HTTP. Esta rota fica só para acionar a rodada manualmente
// (curl com o CRON_SECRET) e para inspecionar o comportamento em produção.

import { NextRequest, NextResponse } from 'next/server'
import { runTrialReminders } from '@/jobs/trialReminders'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const resultado = await runTrialReminders()
    return NextResponse.json(resultado)
  } catch (error) {
    console.error('[cron/trial-reminders]', error)
    return NextResponse.json({ error: 'Erro ao enviar lembretes' }, { status: 500 })
  }
}
