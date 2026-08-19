// src/app/api/alertas/email/route.ts
// POST — envia notificações de alerta por email via Resend

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Resend } from 'resend'
import { authOptions } from '@/lib/auth'
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

  // O destinatário é SEMPRE o e-mail da própria sessão — nunca um valor vindo do
  // client. Sem isto, qualquer conta autenticada podia mandar e-mail (com HTML
  // arbitrário nas notifs) para qualquer endereço, usando o domínio da empresa
  // como relay de phishing.
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const to = session.user.email

  let body: { notifs: AlertaNotificacao[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { notifs } = body

  if (!Array.isArray(notifs) || notifs.length === 0) {
    return NextResponse.json({ error: 'Nenhuma notificação fornecida' }, { status: 400 })
  }

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
