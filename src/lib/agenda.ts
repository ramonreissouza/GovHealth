// src/lib/agenda.ts — Agenda operacional de prazos (item #4 do TOP10 v2).
// A GovHealth encontra a oportunidade mas abandonava o vendedor no dia a dia;
// prazo perdido é venda perdida. Esta agenda reúne os prazos que o usuário já
// registrou — nos negócios do CRM (deal.prazo) e nos dossiês de edital
// (workspace.prazos[]) — num só lugar, com exportação .ics para
// Google Calendar / Outlook. Tudo client-side (localStorage), sem custo.

import { getDeals } from '@/lib/crm'
import { getWorkspaces } from '@/lib/edital-workspace'

export interface PrazoAgenda {
  id: string
  titulo: string
  subtitulo: string
  data: string            // ISO (yyyy-mm-dd)
  origem: 'crm' | 'edital'
  link?: string
  concluido: boolean
  diasRestantes: number   // negativo = atrasado; 0 = hoje
}

export function diasAte(iso: string): number {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const d = new Date(`${iso.substring(0, 10)}T00:00:00`)
  return Math.round((d.getTime() - hoje.getTime()) / 86_400_000)
}

// Reúne prazos das duas fontes, ordenados por data (mais próximos primeiro).
export function getPrazosAgenda(): PrazoAgenda[] {
  const prazos: PrazoAgenda[] = []

  // CRM — data de fechamento previsto dos negócios ativos (ignora ganho/perdido).
  for (const d of getDeals()) {
    if (!d.prazo || d.stage === 'ganho' || d.stage === 'perdido') continue
    prazos.push({
      id: `crm-${d.id}`,
      titulo: d.titulo || d.hospital || 'Negócio',
      subtitulo: [d.hospital, [d.municipio, d.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '),
      data: d.prazo,
      origem: 'crm',
      link: d.licitacaoLink,
      concluido: false,
      diasRestantes: diasAte(d.prazo),
    })
  }

  // Dossiês de edital — cada prazo do certame com data (mantém os concluídos p/ histórico).
  for (const w of getWorkspaces()) {
    for (const p of w.prazos) {
      if (!p.data) continue
      prazos.push({
        id: `ed-${w.id}-${p.id}`,
        titulo: p.rotulo,
        subtitulo: [w.titulo, w.uf].filter(Boolean).join(' · '),
        data: p.data,
        origem: 'edital',
        link: w.linkEdital,
        concluido: p.feito,
        diasRestantes: diasAte(p.data),
      })
    }
  }

  return prazos.sort((a, b) => a.data.localeCompare(b.data))
}

// ── Exportação .ics (RFC 5545) ────────────────────────────────────────────────

function escICS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function ymd(iso: string): string {
  return iso.substring(0, 10).replace(/-/g, '')
}

// DTEND all-day é exclusivo → dia seguinte.
function ymdNext(iso: string): string {
  const d = new Date(`${iso.substring(0, 10)}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function dtstamp(): string {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getUTCFullYear()}${p(n.getUTCMonth() + 1)}${p(n.getUTCDate())}T${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}Z`
}

/** Monta um arquivo .ics (VCALENDAR) com um VEVENT de dia inteiro por prazo. */
export function buildICS(prazos: PrazoAgenda[]): string {
  const stamp = dtstamp()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GovHealth AI//Agenda de Prazos//PT-BR',
    'CALSCALE:GREGORIAN',
  ]
  for (const p of prazos) {
    const desc = [p.subtitulo, p.origem === 'crm' ? 'Origem: Pipeline CRM' : 'Origem: Dossiê de edital', p.link]
      .filter(Boolean)
      .join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@govhealth.ai`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(p.data)}`,
      `DTEND;VALUE=DATE:${ymdNext(p.data)}`,
      `SUMMARY:${escICS(`[GovHealth] ${p.titulo}`)}`,
      `DESCRIPTION:${escICS(desc)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/** Dispara o download de um .ics no navegador. */
export function baixarICS(prazos: PrazoAgenda[], nomeArquivo = 'agenda-govhealth.ics'): void {
  if (typeof window === 'undefined' || prazos.length === 0) return
  const blob = new Blob([buildICS(prazos)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
