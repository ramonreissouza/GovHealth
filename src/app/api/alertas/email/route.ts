// src/app/api/alertas/email/route.ts
// POST — envia notificações de alerta por email via Resend

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import type { AlertaNotificacao } from '@/lib/alertas'
import { buildAlertaDigestHtml } from '@/lib/alerta-email'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY não configurada' },
      { status: 503 }
    )
  }

  let body: { notifs: AlertaNotificacao[]; destinatario?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { notifs, destinatario } = body

  if (!Array.isArray(notifs) || notifs.length === 0) {
    return NextResponse.json({ error: 'Nenhuma notificação fornecida' }, { status: 400 })
  }

  const to = destinatario ?? process.env.AUTH_DEMO_EMAIL ?? 'demo@govhealth.ai'
  const from = process.env.RESEND_FROM_EMAIL ?? 'contato@techealth.com.br'

  const resend = new Resend(apiKey)

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `GovHealth AI — ${notifs.length} nova${notifs.length !== 1 ? 's' : ''} notificação${notifs.length !== 1 ? 'ões' : ''} de alerta`,
      html: buildAlertaDigestHtml(notifs, to),
    })

    if (error) {
      console.error('[alertas/email]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data?.id, destinatario: to })
  } catch (err) {
    console.error('[alertas/email]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
