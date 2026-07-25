// src/lib/alerta-email.ts — HTML do e-mail de alertas (resumo). Compartilhado pelo
// envio manual (/api/alertas/email) e pelo cron diário (/api/cron/alertas-email).
// Cada item vira um LINK clicável que leva ao lead na sessão de licitações.

import type { AlertaNotificacao } from '@/lib/alertas'

const URGENCIA_COLOR: Record<string, string> = {
  alta: '#f87171',
  media: '#f59e0b',
  normal: '#94a3b8',
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://gov-health.vercel.app').replace(/\/$/, '')
}

// Monta uma linha do resumo. Se houver link, o título vira âncora para o lead.
function linha(n: AlertaNotificacao, base: string): string {
  const cor = URGENCIA_COLOR[n.urgencia] ?? URGENCIA_COLOR.normal
  const href = n.link ? (n.link.startsWith('http') ? n.link : `${base}${n.link}`) : null
  const titulo = href
    ? `<a href="${href}" style="color:#00ff9d;text-decoration:none;">${n.titulo} →</a>`
    : `<span style="color:#fff;">${n.titulo}</span>`
  return `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #2a2a4a;">
        <div style="margin-bottom:4px;">
          <span style="background:${cor}20;color:${cor};border:1px solid ${cor}40;font-size:10px;font-family:monospace;padding:2px 6px;border-radius:999px;text-transform:uppercase;">${n.urgencia}</span>
          ${n.uf ? `<span style="font-size:10px;color:#888;font-family:monospace;margin-left:6px;">${n.uf}</span>` : ''}
          <span style="font-size:10px;color:#666;font-family:monospace;margin-left:6px;">via ${n.alertaNome}</span>
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${titulo}</div>
        <div style="font-size:12px;color:#aaa;line-height:1.5;">${n.descricao}</div>
      </td>
    </tr>`
}

export function buildAlertaDigestHtml(notifs: AlertaNotificacao[], destinatario: string): string {
  const base = appBaseUrl()
  const rows = notifs.slice(0, 30).map((n) => linha(n, base)).join('')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#111827;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:20px 24px;background:#131324;border-bottom:1px solid #2a2a4a;">
        <div style="font-size:15px;font-weight:700;color:#fff;">GovHealth.ai</div>
        <div style="font-size:10px;color:#666;font-family:monospace;">Alertas de Licitações</div>
      </td></tr>
      <tr><td style="padding:20px 24px;border-bottom:1px solid #2a2a4a;">
        <div style="font-size:16px;font-weight:600;color:#fff;margin-bottom:6px;">
          ${notifs.length} oportunidade${notifs.length !== 1 ? 's' : ''} que combina${notifs.length !== 1 ? 'm' : ''} com seus monitores
        </div>
        <div style="font-size:12px;color:#aaa;">Clique em uma oportunidade para abrir o lead na plataforma.</div>
      </td></tr>
      <tr><td><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
      <tr><td style="padding:16px 24px;background:#131324;border-top:1px solid #2a2a4a;">
        <div style="font-size:11px;color:#555;font-family:monospace;">Enviado para ${destinatario} · GovHealth AI</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}
