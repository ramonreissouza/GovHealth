// src/app/api/cron/sync-pncp/route.ts — casca HTTP para disparo manual/debug.
//
// O agendamento de verdade não é mais este cron da Vercel: é o worker pg-boss
// (src/worker/index.ts), que roda a mesma lógica em src/jobs/syncPncp.ts direto,
// sem passar por HTTP. Esta rota fica só para acionar a rodada manualmente
// (curl com o CRON_SECRET) e para inspecionar o comportamento em produção.

import { NextRequest, NextResponse } from 'next/server'
import { runSyncPncp } from '@/jobs/syncPncp'

export const runtime = 'nodejs'
// 120s → 300s (teto atual da Vercel em todos os planos) porque os 120s eram o que
// segurava o TETO DE COLETA descrito em src/jobs/syncPncp.ts. Não é folga de
// segurança: é volume.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // Vercel Cron autentica via CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const resultado = await runSyncPncp()
    return NextResponse.json(resultado)
  } catch (error) {
    console.error('[cron:sync-pncp]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
