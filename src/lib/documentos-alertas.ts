// src/lib/documentos-alertas.ts — aviso por e-mail de certidões vencendo/vencidas.
// Chamado pelo cron diário (alertas-email). Independe dos monitores: avisa a conta
// TITULAR sobre documentos do Cofre que vencem em ≤30 dias ou já venceram. Dedup por
// (documento, validade, estado) em user_data.chave='documentos-avisos-sent' — no
// máximo um aviso "vencendo" e um "vencido" por validade, sem spam diário.

import { Resend } from 'resend'
import { query } from '@/lib/db'
import { estadoDoc, tipoLabel, diasParaVencer, DIAS_ALERTA } from '@/lib/documentos'

interface DocRow {
  id: string; titular_id: string; tipo: string; nome: string
  validade: string | null; sem_validade: boolean; email: string; titular_nome: string | null
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function buildHtml(docs: DocRow[], nome: string | null, hojeMs: number): string {
  const linhas = docs.map((d) => {
    const estado = estadoDoc({ validade: d.validade, semValidade: d.sem_validade }, hojeMs)
    const dias = diasParaVencer(d.validade, hojeMs) ?? 0
    const txt = estado === 'vencido' ? `Vencido há ${Math.abs(dias)} dia(s)` : `Vence em ${dias} dia(s)`
    const cor = estado === 'vencido' ? '#dc2626' : '#d97706'
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:#111">${esc(d.nome)}<br><span style="font-size:11px;color:#888">${esc(tipoLabel(d.tipo))}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:#111">${esc(d.validade ?? '—')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;font-weight:600;color:${cor}">${txt}</td>
    </tr>`
  }).join('')
  const url = process.env.NEXT_PUBLIC_APP_URL ?? 'https://gov-health.vercel.app'
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto">
    <h2 style="font-size:18px;color:#111">Documentos a renovar${nome ? `, ${esc(nome)}` : ''}</h2>
    <p style="font-size:13px;color:#444">Estes documentos do seu Cofre vencem em até ${DIAS_ALERTA} dias ou já venceram. Certidão vencida trava participação em pregão — renove antes.</p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0">
      <thead><tr style="text-align:left">
        <th style="padding:8px 12px;border-bottom:2px solid #ddd;font-size:11px;color:#888;text-transform:uppercase">Documento</th>
        <th style="padding:8px 12px;border-bottom:2px solid #ddd;font-size:11px;color:#888;text-transform:uppercase">Validade</th>
        <th style="padding:8px 12px;border-bottom:2px solid #ddd;font-size:11px;color:#888;text-transform:uppercase">Situação</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    <a href="${url}/documentos" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px">Abrir o Cofre de Documentos</a>
  </div>`
}

/** Envia o digest de vencimentos por titular. Retorna quantos e-mails saíram. */
export async function enviarAvisosDocumentos(apiKey: string, from: string): Promise<{ titulares: number; emails: number }> {
  const rows = await query<DocRow>(
    `SELECT d.id, d.titular_id, d.tipo, d.nome, to_char(d.validade,'YYYY-MM-DD') AS validade, d.sem_validade,
            u.email, u.nome AS titular_nome
       FROM documentos d JOIN usuarios u ON u.id = d.titular_id
      WHERE d.sem_validade = false AND d.validade IS NOT NULL
        AND d.validade <= (CURRENT_DATE + ${DIAS_ALERTA})`,
  )
  if (rows.length === 0) return { titulares: 0, emails: 0 }

  const porTitular = new Map<string, { email: string; nome: string | null; docs: DocRow[] }>()
  for (const r of rows) {
    const g = porTitular.get(r.titular_id) ?? { email: r.email, nome: r.titular_nome, docs: [] }
    g.docs.push(r); porTitular.set(r.titular_id, g)
  }

  const resend = new Resend(apiKey)
  const hoje = Date.now()
  const keyDe = (d: DocRow) => `${d.id}:${d.validade}:${estadoDoc({ validade: d.validade, semValidade: d.sem_validade }, hoje)}`
  let emails = 0

  for (const [titularId, g] of porTitular) {
    if (!g.email) continue
    const sentRow = await query<{ valor: unknown }>(
      `SELECT valor FROM user_data WHERE user_id = $1 AND chave = 'documentos-avisos-sent'`, [titularId],
    )
    const enviados: string[] = Array.isArray(sentRow[0]?.valor) ? (sentRow[0]!.valor as string[]) : []
    const jaEnviado = new Set(enviados)
    const novos = g.docs.filter((d) => !jaEnviado.has(keyDe(d)))
    if (novos.length === 0) continue
    novos.sort((a, b) => (a.validade ?? '').localeCompare(b.validade ?? ''))

    try {
      const { error } = await resend.emails.send({
        from, to: g.email,
        subject: `GovHealth AI — ${novos.length} documento(s) a renovar`,
        html: buildHtml(novos, g.nome, hoje),
      })
      if (error) { console.error('[docs-avisos]', g.email, error); continue }
      emails++
    } catch (e) { console.error('[docs-avisos] send', g.email, e); continue }

    const merged = [...novos.map(keyDe), ...enviados].slice(0, 2000)
    await query(
      `INSERT INTO user_data (user_id, chave, valor, atualizado_em)
       VALUES ($1,'documentos-avisos-sent',$2::jsonb, now())
       ON CONFLICT (user_id, chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [titularId, JSON.stringify(merged)],
    )
  }
  return { titulares: porTitular.size, emails }
}
