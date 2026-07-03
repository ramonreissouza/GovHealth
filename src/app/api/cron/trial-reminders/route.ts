// src/app/api/cron/trial-reminders/route.ts — lembrete "seu teste expira amanhã".
// Roda 1x/dia (vercel.json). Protegido pelo CRON_SECRET (Bearer), como os demais.
// Reivindica atomicamente os trials que expiram amanhã (marca antes de enviar,
// para não reenviar em retries) e dispara o e-mail (best-effort).
import { NextRequest, NextResponse } from 'next/server'
import { reivindicarLembretesTrial } from '@/lib/users'
import { enviarLembreteTrial } from '@/lib/email'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const alvos = await reivindicarLembretesTrial()
    let enviados = 0
    for (const u of alvos) {
      const r = await enviarLembreteTrial({ email: u.email, nome: u.nome, plano: u.plano ?? 'pro', expiraEm: u.expira_em })
      if (r.enviado) enviados++
      else console.warn(`[cron/trial-reminders] não enviado p/ ${u.email}: ${r.motivo}`)
    }
    return NextResponse.json({ ok: true, candidatos: alvos.length, enviados })
  } catch (e) {
    console.error('[cron/trial-reminders]', e)
    return NextResponse.json({ error: 'Erro ao enviar lembretes' }, { status: 500 })
  }
}
