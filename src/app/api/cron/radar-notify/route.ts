// src/app/api/cron/radar-notify/route.ts — entrega dos alertas do Radar por e-mail.
// O worker de captura e a seleção apenas ENFILEIRAM em radar_notificacoes; este
// cron (HTTP, roda bem em serverless) envia via Resend — desacopla a entrega da
// máquina do worker. Protegido por CRON_SECRET. Roda a cada ~15 min (vercel.json).
// Também escalona alertas de mensagem não confirmados dentro do SLA.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { enviarNovaLicitacaoRadar, enviarAlertaRadar } from '@/lib/email'

export const runtime = 'nodejs'
export const maxDuration = 60

const SLA_ESCALONA_MIN = 30

interface Pendente {
  id: string; titular_id: string; evento: string; mensagem_id: number | null
  destinatario: string; assunto: string | null; corpo: string | null; link: string | null
  texto: string | null; autor: string | null; proc_titulo: string | null
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const pendentes = await query<Pendente>(
      `SELECT n.id, n.titular_id, n.evento, n.mensagem_id, n.destinatario, n.assunto, n.corpo, n.link,
              m.texto, m.autor, p.titulo AS proc_titulo
         FROM radar_notificacoes n
         LEFT JOIN radar_mensagens m ON m.id = n.mensagem_id
         LEFT JOIN radar_processos p ON p.id = n.processo_id
        WHERE n.canal = 'email' AND n.status = 'pendente'
        ORDER BY n.criado_em
        LIMIT 50`,
    )

    let enviados = 0
    for (const n of pendentes) {
      let ok = false
      let motivo: string | undefined
      try {
        if (n.evento === 'nova_licitacao') {
          const c = n.corpo ? JSON.parse(n.corpo) as { objeto?: string; uf?: string; municipio?: string; valor?: number; motivo?: string; nome?: string } : {}
          const r = await enviarNovaLicitacaoRadar({
            to: n.destinatario, nome: c.nome, objeto: c.objeto ?? n.assunto ?? '', uf: c.uf,
            municipio: c.municipio, valor: c.valor, motivo: c.motivo, link: n.link ?? '',
          })
          ok = r.enviado; motivo = r.motivo
        } else {
          const r = await enviarAlertaRadar({
            to: n.destinatario, processo: n.proc_titulo ?? 'Processo monitorado',
            autor: n.autor, trecho: (n.texto ?? '').slice(0, 280), link: n.link ?? '',
          })
          ok = r.enviado; motivo = r.motivo
        }
      } catch (e) { motivo = String(e) }

      if (ok) enviados++
      await query(
        `UPDATE radar_notificacoes
            SET status = $2, tentativas = tentativas + 1, enviado_em = CASE WHEN $2 = 'enviado' THEN now() ELSE enviado_em END, erro = $3
          WHERE id = $1`,
        [n.id, ok ? 'enviado' : 'falha', ok ? null : (motivo ?? 'falha')],
      )
    }

    // Escalonamento: alertas de mensagem enviados há mais de SLA sem confirmação de leitura.
    const escalonados = await query<{ id: string }>(
      `UPDATE radar_notificacoes
          SET escalonado_em = now()
        WHERE evento = 'nova_mensagem' AND status = 'enviado'
          AND confirmado_em IS NULL AND escalonado_em IS NULL
          AND enviado_em < now() - ($1 || ' minutes')::interval
        RETURNING id`,
      [String(SLA_ESCALONA_MIN)],
    )

    return NextResponse.json({ ok: true, pendentes: pendentes.length, enviados, escalonados: escalonados.length })
  } catch (e) {
    console.error('[cron/radar-notify]', e)
    return NextResponse.json({ error: 'Erro ao processar notificações do Radar' }, { status: 500 })
  }
}
