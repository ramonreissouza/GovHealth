// src/app/api/cron/alertas-email/route.ts — resumo DIÁRIO por e-mail dos leads que
// combinam com os monitores do usuário. Roda 1x/dia (Vercel Cron).
//
// Como os monitores vivem na CONTA (user_data.chave='alertas-config'), o servidor
// consegue casar cada usuário com editais/emendas recentes e e-mailar SÓ o que é novo
// e relevante. Dedup por usuário em user_data.chave='alertas-sent'.
//
// - Editais: match preciso pelo monitor (termos/UF/categoria/valor). Link → o lead.
// - Emendas: match GEOGRÁFICO (UF do monitor) — o produto não vem na listagem da
//   emenda, então tratamos como sinal de demanda na região. Link → oportunidades da UF.

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { query } from '@/lib/db'
import { matchItem, type AlertaConfig, type AlertaNotificacao, type ItemParaMatch } from '@/lib/alertas'
import { buildAlertaDigestHtml } from '@/lib/alerta-email'

export const runtime = 'nodejs'
export const maxDuration = 60

const UFS_VALIDAS = new Set(['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'])
function ufDaLocalidade(loc?: string | null): string | undefined {
  if (!loc) return undefined
  return (loc.toUpperCase().match(/[A-Z]{2}/g) ?? []).find((t) => UFS_VALIDAS.has(t))
}
const kBRL = (v: number) => `R$${Math.round(v / 1000)}K`

interface UsuarioMonitores { email: string; nome: string | null; monitores: AlertaConfig[]; enviados: string[] }

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // E-mail é best-effort (como todo o app): sem chave, o cron não falha — só informa
  // que está inerte até a RESEND_API_KEY ser configurada na Vercel.
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ ok: true, skipped: true, motivo: 'RESEND_API_KEY não configurada — e-mail inerte até definir a chave' })

  const inicio = Date.now()
  try {
    // 1) Usuários com monitores + o que já foi enviado (dedup).
    const rows = await query<{ email: string; nome: string | null; monitores: unknown; enviados: unknown }>(
      `SELECT u.email, u.nome, cfg.valor AS monitores, sent.valor AS enviados
         FROM user_data cfg
         JOIN usuarios u ON u.id = cfg.user_id
         LEFT JOIN user_data sent ON sent.user_id = cfg.user_id AND sent.chave = 'alertas-sent'
        WHERE cfg.chave = 'alertas-config'`,
    )
    const usuarios: UsuarioMonitores[] = rows
      .map((r) => ({
        email: r.email,
        nome: r.nome,
        monitores: (Array.isArray(r.monitores) ? r.monitores : []) as AlertaConfig[],
        enviados: (Array.isArray(r.enviados) ? r.enviados : []) as string[],
      }))
      // só quem tem ao menos um monitor ATIVO com e-mail habilitado
      .filter((u) => u.email && u.monitores.some((m) => m.ativo && m.emailHabilitado))
    if (usuarios.length === 0) {
      return NextResponse.json({ ok: true, usuarios: 0, enviados: 0, motivo: 'nenhum monitor com e-mail' })
    }

    // 2) Itens recentes (compartilhados entre usuários) — editais abertos + emendas.
    const editaisRows = await query<{ n: string; orgao: string | null; mun: string | null; uf: string | null; obj: string | null; cat: string | null; v: number | null }>(
      `SELECT numero_controle_pncp n, razao_social_orgao orgao, municipio mun, uf, objeto_compra obj,
              categoria_saude cat, valor_total_estimado::float8 v
         FROM contratacoes c
        WHERE (valor_total_estimado >= 10000 OR fonte <> 'pncp') AND objeto_compra IS NOT NULL
          AND coletado_em > now() - interval '2 days'
          AND NOT EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp)
        ORDER BY coletado_em DESC LIMIT 800`,
    )
    const editais: ItemParaMatch[] = editaisRows.map((e) => ({
      id: `edital-${e.n}`,
      titulo: 'Edital de saúde publicado',
      descricao: `${e.orgao ?? 'Órgão N/D'} (${[e.mun, e.uf].filter(Boolean).join('/') || 'N/D'}): ${(e.obj ?? '').slice(0, 90)}… — ${kBRL(e.v ?? 0)}`,
      uf: e.uf ?? undefined,
      categoria: e.cat ?? undefined,
      valor: e.v ?? undefined,
      urgencia: 'alta',
      link: `/oportunidades?opp=${encodeURIComponent(`pncp-${e.n}`)}`,
    }))

    // Emendas recentes (match geográfico por UF).
    let emendas: { id: string; titulo: string; descricao: string; uf?: string; link: string }[] = []
    try {
      const er = await query<{ cod: string; autor: string | null; loc: string | null; val: string | null; ano: number | null }>(
        `SELECT codigo_emenda cod, autor, localidade_gasto loc, valor_empenhado val, ano
           FROM emendas_saude WHERE coletado_em > now() - interval '10 days' ORDER BY ano DESC LIMIT 300`,
      )
      emendas = er.map((x) => {
        const uf = ufDaLocalidade(x.loc)
        return {
          id: `emenda-${x.cod}`,
          titulo: `Emenda parlamentar de saúde${x.ano ? ` (${x.ano})` : ''}`,
          descricao: `${x.loc ?? 'Localidade N/D'}. Autor: ${x.autor ?? 'N/D'}.`,
          uf,
          link: uf ? `/oportunidades?uf=${uf}&status=aberto` : '/radar-verba',
        }
      })
    } catch { /* tabela de emendas ausente — segue só com editais */ }

    // 3) Por usuário: casa, deduplica, e-maila os novos.
    const resend = new Resend(apiKey)
    const from = process.env.RESEND_FROM_EMAIL ?? 'contato@techealth.com.br'
    let enviados = 0

    for (const u of usuarios) {
      const ativos = u.monitores.filter((m) => m.ativo && m.emailHabilitado)
      const jaEnviado = new Set(u.enviados)
      const novas: AlertaNotificacao[] = []

      for (const m of ativos) {
        // Editais: match preciso.
        for (const it of editais) {
          if (jaEnviado.has(`${m.id}:${it.id}`)) continue
          if (matchItem(it, m)) {
            novas.push({ id: `${m.id}:${it.id}`, alertaId: m.id, alertaNome: m.nome, titulo: it.titulo, descricao: it.descricao, urgencia: 'alta', link: it.link, uf: it.uf, lida: false, criadoEm: new Date().toISOString() })
          }
        }
        // Emendas: match GEOGRÁFICO (UF do monitor, ou monitor sem UF = todas).
        for (const em of emendas) {
          const key = `${m.id}:${em.id}`
          if (jaEnviado.has(key)) continue
          const ufOk = m.ufs.length === 0 || (em.uf != null && m.ufs.includes(em.uf))
          if (ufOk) {
            novas.push({ id: key, alertaId: m.id, alertaNome: m.nome, titulo: em.titulo, descricao: em.descricao, urgencia: 'media', link: em.link, uf: em.uf, lida: false, criadoEm: new Date().toISOString() })
          }
        }
      }

      // Dedup interno (um item pode casar 2 monitores) por id.
      const uniq = Array.from(new Map(novas.map((n) => [n.id, n])).values())
      if (uniq.length === 0) continue

      try {
        const { error } = await resend.emails.send({
          from,
          to: u.email,
          subject: `GovHealth AI — ${uniq.length} oportunidade${uniq.length !== 1 ? 's' : ''} para você`,
          html: buildAlertaDigestHtml(uniq, u.email),
        })
        if (error) { console.error('[cron:alertas-email]', u.email, error); continue }
        enviados++
      } catch (e) { console.error('[cron:alertas-email] send', u.email, e); continue }

      // Marca como enviados (cap 2000, mais recentes primeiro).
      const novoEnviados = [...uniq.map((n) => n.id), ...u.enviados].slice(0, 2000)
      await query(
        `INSERT INTO user_data (user_id, chave, valor, atualizado_em)
         VALUES ((SELECT id FROM usuarios WHERE email = $1), 'alertas-sent', $2::jsonb, now())
         ON CONFLICT (user_id, chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
        [u.email, JSON.stringify(novoEnviados)],
      )
    }

    const msg = `[cron:alertas-email] usuarios=${usuarios.length} e-mails=${enviados} editais=${editais.length} emendas=${emendas.length} em ${Date.now() - inicio}ms`
    console.log(msg)
    return NextResponse.json({ ok: true, usuarios: usuarios.length, enviados, editais: editais.length, emendas: emendas.length })
  } catch (error) {
    console.error('[cron:alertas-email]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
