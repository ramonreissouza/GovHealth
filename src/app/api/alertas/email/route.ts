// src/app/api/alertas/email/route.ts
// POST — envia notificações de alerta por email via Resend

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import type { AlertaNotificacao } from '@/lib/alertas'

export const runtime = 'nodejs'

const URGENCIA_COLOR: Record<string, string> = {
  alta:   '#f87171',
  media:  '#f59e0b',
  normal: '#94a3b8',
}

function buildHtml(notifs: AlertaNotificacao[], destinatario: string): string {
  const rows = notifs
    .slice(0, 20)
    .map(
      (n) => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #2a2a4a;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="
              background:${URGENCIA_COLOR[n.urgencia]}20;
              color:${URGENCIA_COLOR[n.urgencia]};
              border:1px solid ${URGENCIA_COLOR[n.urgencia]}40;
              font-size:10px;font-family:monospace;
              padding:2px 6px;border-radius:999px;text-transform:uppercase;
            ">${n.urgencia}</span>
            <span style="font-size:10px;color:#666;font-family:monospace;">
              via ${n.alertaNome}
            </span>
          </div>
          <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">${n.titulo}</div>
          <div style="font-size:12px;color:#aaa;line-height:1.5;">${n.descricao}</div>
        </td>
      </tr>`
    )
    .join('')

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body style="margin:0;padding:0;background:#111827;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table width="600" cellpadding="0" cellspacing="0"
              style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;overflow:hidden;">

              <!-- Header -->
              <tr>
                <td style="padding:20px 24px;background:#131324;border-bottom:1px solid #2a2a4a;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:28px;height:28px;background:#00ff9d;border-radius:6px;
                      display:flex;align-items:center;justify-content:center;">
                      <span style="font-weight:bold;font-size:14px;color:#000;">G</span>
                    </div>
                    <div>
                      <div style="font-size:15px;font-weight:700;color:#fff;">GovHealth.ai</div>
                      <div style="font-size:10px;color:#666;font-family:monospace;">Alertas de Licitações</div>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Summary -->
              <tr>
                <td style="padding:20px 24px;border-bottom:1px solid #2a2a4a;">
                  <div style="font-size:16px;font-weight:600;color:#fff;margin-bottom:6px;">
                    ${notifs.length} nova${notifs.length !== 1 ? 's' : ''} notificação${notifs.length !== 1 ? 'ões' : ''}
                  </div>
                  <div style="font-size:12px;color:#aaa;">
                    Detectamos novas licitações que correspondem aos seus monitores configurados.
                  </div>
                </td>
              </tr>

              <!-- Notifications -->
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${rows}
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:16px 24px;background:#131324;border-top:1px solid #2a2a4a;">
                  <div style="font-size:11px;color:#555;font-family:monospace;">
                    Enviado para ${destinatario} · GovHealth AI
                  </div>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}

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
  const from = process.env.RESEND_FROM_EMAIL ?? 'alertas@govhealth.ai'

  const resend = new Resend(apiKey)

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `GovHealth AI — ${notifs.length} nova${notifs.length !== 1 ? 's' : ''} notificação${notifs.length !== 1 ? 'ões' : ''} de alerta`,
      html: buildHtml(notifs, to),
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
