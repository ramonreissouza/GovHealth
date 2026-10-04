// src/app/api/radar/vi/route.ts — o botão "Vi" dos avisos do Radar por e-mail.
//
// GET mostra uma página com o botão; só o POST confirma. Se o GET confirmasse, o
// antivírus do e-mail (Safe Links do Outlook, Proofpoint, Mimecast…), que abre todo link
// antes da pessoa, marcaria o aviso como visto sozinho, e o repasse para a equipe nunca
// aconteceria. O token assinado (src/lib/radar/vi-token.ts) é a autorização: não há login,
// porque quem recebe a convocação está no celular. Fora do middleware de sessão por isso.
//
// Confirmar aqui tem o mesmo efeito de abrir a mensagem na tela do Radar: todas as
// notificações daquela mensagem ficam confirmadas, inclusive a repassada, e o job
// radar-notify não escala mais.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { lerTokenVi } from '@/lib/radar/vi-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Notif {
  id: string; titular_id: string; mensagem_id: number | null; destinatario: string
  assunto: string | null; link: string | null; confirmado_em: string | null
  /** O aviso desta mensagem já foi repassado, e para quem. */
  repassado_para: string | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const hora = (v: string | Date) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(v))

function pagina(titulo: string, corpo: string, status = 200): NextResponse {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${esc(titulo)} · GovHealth</title></head>
<body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
<main style="max-width:440px;margin:48px auto;padding:0 16px;">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;">
<h1 style="font-size:19px;margin:0 0 12px;">${esc(titulo)}</h1>${corpo}
</div></main></body></html>`
  return new NextResponse(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // O token está na URL: não vazar para o portal quando a pessoa clicar no link dele.
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  })
}

const invalido = () => pagina('Link vencido ou inválido',
  '<p style="font-size:14px;color:#334155;margin:0;">Este link de confirmação venceu (vale 7 dias) ou foi copiado pela metade. Abra a mensagem no Radar para marcá-la como lida.</p>', 400)

async function carregar(token: string | null): Promise<Notif | null> {
  const id = lerTokenVi(token)
  if (!id) return null
  return queryOne<Notif>(
    `SELECT n.id, n.titular_id, n.mensagem_id, n.destinatario, n.assunto, n.link, n.confirmado_em,
            (SELECT o.escalonado_para FROM radar_notificacoes o
              WHERE o.titular_id = n.titular_id AND o.mensagem_id = n.mensagem_id
                AND o.escalonado_em IS NOT NULL AND o.escalonado_para IS NOT NULL
              LIMIT 1) AS repassado_para
       FROM radar_notificacoes n WHERE n.id = $1`, [id],
  )
}

/** O que dizer sobre o repasse depois do "Vi": não prometer o que já aconteceu. */
function sobreRepasse(n: Notif): string {
  if (!n.repassado_para) return 'O aviso não vai ser repassado para outra pessoa da equipe.'
  if (n.repassado_para.toLowerCase() === n.destinatario.toLowerCase()) return 'A equipe fica sabendo que você está cuidando.'
  return `Ele já tinha sido repassado para ${esc(n.repassado_para)}; agora a equipe sabe que alguém está cuidando.`
}

const linkPortal = (n: Notif) => n.link
  ? `<p style="margin:16px 0 0;"><a href="${esc(n.link)}" rel="noreferrer" style="font-size:14px;color:#2f80ed;">Abrir o pregão no portal</a></p>`
  : ''

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t')
  const n = await carregar(token)
  if (!n) return invalido()
  if (n.confirmado_em) {
    return pagina('Já confirmado', `<p style="font-size:14px;color:#334155;margin:0;">Este aviso já foi confirmado em ${esc(hora(n.confirmado_em))} (horário de Brasília).${n.repassado_para ? ` Antes disso, ele tinha sido repassado para ${esc(n.repassado_para)}.` : ''}</p>${linkPortal(n)}`)
  }
  return pagina('Confirmar que você viu', `
<p style="font-size:14px;color:#334155;margin:0 0 6px;">${esc(n.assunto ?? 'Aviso do Radar')}</p>
<p style="font-size:13px;color:#64748b;margin:0 0 16px;">${n.repassado_para ? 'Confirmando, a equipe fica sabendo que alguém está cuidando.' : 'Confirmando, o aviso não é repassado para outra pessoa da equipe.'}</p>
<form method="post" action="/api/radar/vi">
<input type="hidden" name="t" value="${esc(token ?? '')}"/>
<button type="submit" style="background:#2f80ed;color:#fff;border:0;font-size:15px;font-weight:600;padding:12px 22px;border-radius:9px;cursor:pointer;">Vi, estou cuidando</button>
</form>${linkPortal(n)}`)
}

export async function POST(req: NextRequest) {
  let token: string | null = null
  try { token = String((await req.formData()).get('t') ?? '') } catch { token = null }
  const n = await carregar(token)
  if (!n) return invalido()

  if (!n.confirmado_em) {
    // Quem confirmou: a conta dona do e-mail que recebeu o aviso, quando existir.
    const quem = await queryOne<{ id: string }>(
      `SELECT id FROM usuarios WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [n.destinatario],
    )
    if (n.mensagem_id != null) {
      await query(
        `UPDATE radar_notificacoes SET confirmado_em = now()
          WHERE mensagem_id = $1 AND titular_id = $2 AND confirmado_em IS NULL`,
        [n.mensagem_id, n.titular_id],
      )
      await query(
        `UPDATE radar_mensagens SET lida = true, lida_por = coalesce(lida_por, $3), lida_em = coalesce(lida_em, now())
          WHERE id = $1 AND titular_id = $2`,
        [n.mensagem_id, n.titular_id, quem?.id ?? null],
      )
    } else {
      await query(`UPDATE radar_notificacoes SET confirmado_em = now() WHERE id = $1 AND confirmado_em IS NULL`, [n.id])
    }
    await query(
      `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id, detalhe)
       VALUES ($1, $2, 'leitura', 'radar_mensagens', $3, $4::jsonb)`,
      [n.titular_id, quem?.id ?? null, String(n.mensagem_id ?? n.id), JSON.stringify({ via: 'email', notificacao: n.id })],
    )
  }
  return pagina('Confirmado', `<p style="font-size:14px;color:#334155;margin:0;">Obrigado. ${sobreRepasse(n)}</p>${linkPortal(n)}`)
}
