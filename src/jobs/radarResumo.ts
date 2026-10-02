// src/jobs/radarResumo.ts — o e-mail ÚNICO do dia do Radar, por destinatário (worker
// pg-boss, 07:30 de Brasília; ver src/worker/index.ts).
//
// Leva o que o radar-notify separou como 'aguardando_resumo': mensagens de chat que não
// citam a empresa do cliente e licitações novas para o perfil. Antes eram um e-mail por
// item — 81 por dia por pessoa, medido em 02/10/2026 (ver src/lib/radar/entrega.ts).

import { query } from '@/lib/db'
import { enviarResumoRadar, type ResumoRadarLicitacao, type ResumoRadarProcesso } from '@/lib/email'

const MAX_PROCESSOS = 8
const MENSAGENS_POR_PROCESSO = 3
const MAX_LICITACOES = 10
/** Depois disto o resumo para de tentar e marca falha (ex.: e-mail recusado de vez). */
const MAX_TENTATIVAS = 3

interface Linha {
  id: string; evento: string; destinatario: string; processo_id: string | null
  link: string | null; assunto: string | null; corpo: string | null; tentativas: number
  texto: string | null; autor: string | null; prioridade: string | null
  capturado_em: string | null; proc_titulo: string | null
}

function montar(linhas: Linha[]) {
  const msgs = linhas.filter((l) => l.evento === 'nova_mensagem')
  const porProcesso = new Map<string, Linha[]>()
  for (const m of msgs) {
    const k = m.processo_id ?? m.proc_titulo ?? '?'
    porProcesso.set(k, [...(porProcesso.get(k) ?? []), m])
  }
  const urg = (l: Linha) => (l.prioridade === 'alta' ? 1 : 0)
  // Pregão com mais urgentes primeiro; empate, o mais movimentado.
  const grupos = [...porProcesso.values()].sort((a, b) =>
    b.filter(urg).length - a.filter(urg).length || b.length - a.length)
  const processos: ResumoRadarProcesso[] = grupos.slice(0, MAX_PROCESSOS).map((g) => {
    const ordenadas = [...g].sort((a, b) =>
      urg(b) - urg(a) || String(b.capturado_em ?? '').localeCompare(String(a.capturado_em ?? '')))
    return {
      titulo: g[0].proc_titulo ?? 'Processo monitorado',
      link: g[0].link ?? '',
      total: g.length,
      mensagens: ordenadas.slice(0, MENSAGENS_POR_PROCESSO).map((m) => ({
        autor: m.autor,
        trecho: (m.texto ?? '').replace(/\s+/g, ' ').slice(0, 200),
        urgente: m.prioridade === 'alta',
      })),
    }
  })

  const lics = linhas.filter((l) => l.evento === 'nova_licitacao')
  const licitacoes: ResumoRadarLicitacao[] = lics.slice(0, MAX_LICITACOES).map((l) => {
    let c: { objeto?: string; uf?: string; municipio?: string; valor?: number } = {}
    try { c = l.corpo ? JSON.parse(l.corpo) : {} } catch { /* corpo antigo, texto puro */ }
    return {
      objeto: c.objeto ?? l.assunto ?? '',
      local: [c.municipio, c.uf].filter(Boolean).join(' / ') || null,
      valor: c.valor ?? null,
      link: l.link ?? '',
    }
  })

  return {
    processos, processosOmitidos: Math.max(0, grupos.length - MAX_PROCESSOS), mensagensTotal: msgs.length,
    licitacoes, licitacoesOmitidas: Math.max(0, lics.length - MAX_LICITACOES),
  }
}

export async function runRadarResumo() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[cron:radar-resumo] RESEND_API_KEY não configurada — fila intacta')
    return { ok: true as const, skipped: true, motivo: 'RESEND_API_KEY não configurada' }
  }
  const inicio = Date.now()

  // Roda uma vez por dia: 'resumindo' aqui é de uma rodada que morreu no meio do envio.
  // Não sabemos se o e-mail saiu; reenviar arriscaria um resumo duplicado.
  await query(
    `UPDATE radar_notificacoes SET status = 'falha', erro = 'resumo interrompido (worker reiniciado)'
      WHERE canal = 'email' AND status = 'resumindo'`,
  )

  const destinatarios = await query<{ destinatario: string }>(
    `SELECT DISTINCT destinatario FROM radar_notificacoes
      WHERE canal = 'email' AND status = 'aguardando_resumo'`,
  )

  let enviados = 0, falhas = 0, itens = 0
  for (const { destinatario } of destinatarios) {
    // Reivindica tudo de uma vez: o que entrar na fila durante o envio fica para amanhã.
    const linhas = await query<Linha>(
      `WITH meu AS (
         UPDATE radar_notificacoes SET status = 'resumindo'
          WHERE canal = 'email' AND status = 'aguardando_resumo' AND destinatario = $1
          RETURNING id)
       SELECT n.id, n.evento, n.destinatario, n.processo_id, n.link, n.assunto, n.corpo, n.tentativas,
              m.texto, m.autor, m.prioridade, m.capturado_em, p.titulo AS proc_titulo
         FROM radar_notificacoes n
         JOIN meu ON meu.id = n.id
         LEFT JOIN radar_mensagens m ON m.id = n.mensagem_id
         LEFT JOIN radar_processos p ON p.id = n.processo_id`,
      [destinatario],
    )
    if (!linhas.length) continue
    const ids = linhas.map((l) => l.id)

    let ok = false
    let motivo: string | undefined
    try {
      const r = await enviarResumoRadar({ to: destinatario, ...montar(linhas) })
      ok = r.enviado; motivo = r.motivo
    } catch (e) { motivo = String(e) }

    if (ok) {
      enviados++; itens += ids.length
      await query(
        `UPDATE radar_notificacoes SET status = 'resumido', enviado_em = now(), tentativas = tentativas + 1, erro = NULL
          WHERE id = ANY($1::text[])`,
        [ids],
      )
    } else {
      falhas++
      // Volta para a fila e tenta amanhã; depois de MAX_TENTATIVAS, desiste.
      await query(
        `UPDATE radar_notificacoes
            SET status = CASE WHEN tentativas + 1 >= $2 THEN 'falha' ELSE 'aguardando_resumo' END,
                tentativas = tentativas + 1, erro = $3
          WHERE id = ANY($1::text[])`,
        [ids, MAX_TENTATIVAS, motivo ?? 'falha'],
      )
    }
  }

  const resultado = { ok: true as const, destinatarios: destinatarios.length, enviados, falhas, itens }
  console.log(`[cron:radar-resumo] ${JSON.stringify(resultado)} em ${Date.now() - inicio}ms`)
  return resultado
}
