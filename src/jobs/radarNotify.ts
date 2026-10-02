// src/jobs/radarNotify.ts — entrega dos alertas IMEDIATOS do Radar por e-mail (worker
// pg-boss, a cada 5 min; ver src/worker/index.ts). A rota
// src/app/api/cron/radar-notify/route.ts virou casca para disparo manual.
//
// A captura e a seleção só ENFILEIRAM em radar_notificacoes (status 'pendente'). Até
// 02/10/2026 ninguém agendava a entrega, e a fila juntou 25.049 e-mails. Cada rodada:
//
//   1. expira o que passou de 48 h na fila — notícia velha não vira e-mail;
//   2. separa o pendente: o que fala da empresa do cliente, ou é urgente num pregão em
//      que ele está, sai agora, sozinho; o resto fica 'aguardando_resumo' para o
//      e-mail único do dia (src/jobs/radarResumo.ts).
//      A regra é src/lib/radar/entrega.ts, com o porquê medido;
//   3. escalona o imediato que ninguém confirmou em 30 min.
//
// Estados de radar_notificacoes.status no e-mail:
//   pendente → enviando → enviado | falha          (imediato)
//   pendente → aguardando_resumo → resumindo → resumido   (resumo do dia)
//   pendente | aguardando_resumo → expirado         (passou de 48 h)
//   qualquer um → entregue                          (lido na tela antes; rota de mensagens)

import { query } from '@/lib/db'
import { enviarAlertaRadar } from '@/lib/email'
import { leituraDoConector } from '@/lib/radar/conectores'
import { entregaDe, JANELA_FILA_H, type AlvoEmpresa } from '@/lib/radar/entrega'

const SLA_ESCALONA_MIN = 30
const LOTE = 500
/** Por destinatário e rodada. O que sobrar sai na próxima rodada, 5 min depois. */
const TETO_AGORA_POR_DESTINATARIO = 5
/** Envio que morreu no meio (worker reiniciado) não é refeito: vira falha, não duplica. */
const ENVIANDO_ORFAO_MIN = 15

interface Pendente {
  id: string; titular_id: string; evento: string; destinatario: string; link: string | null
  texto: string | null; autor: string | null; conector_id: string | null
  categorias: string[] | null; prioridade: string | null
  proc_titulo: string | null; origem: string | null; participando: boolean | null
}

/**
 * Quem é cada titular: CNPJ e nome da conta, nome do Setup da Empresa e as razões
 * sociais com que esse CNPJ aparece nos resultados do PNCP. O chat cita a empresa pela
 * razão social, quase nunca pelo CNPJ nem pelo nome fantasia.
 */
async function carregarAlvos(titulares: string[]): Promise<Map<string, AlvoEmpresa>> {
  const alvos = new Map<string, AlvoEmpresa>()
  if (!titulares.length) return alvos
  const contas = await query<{ id: string; empresa: string | null; cnpj: string | null; setup: string | null }>(
    `SELECT u.id, u.empresa, regexp_replace(coalesce(u.cnpj, ''), '\\D', '', 'g') AS cnpj,
            ud.valor->>'nomeEmpresa' AS setup
       FROM usuarios u
       LEFT JOIN user_data ud ON ud.user_id = u.id AND ud.chave = 'empresa'
      WHERE u.id = ANY($1::text[])`,
    [titulares],
  )
  const cnpjs = contas.map((c) => c.cnpj).filter((c): c is string => !!c && c.length === 14)
  const razoes = cnpjs.length
    ? await query<{ ni: string; nome: string }>(
        `SELECT ni_fornecedor AS ni, nome_fornecedor AS nome
           FROM resultados WHERE ni_fornecedor = ANY($1::text[]) AND nome_fornecedor IS NOT NULL
          GROUP BY 1, 2 ORDER BY count(*) DESC`,
        [cnpjs],
      )
    : []
  for (const c of contas) {
    const daqui = razoes.filter((r) => r.ni === c.cnpj).slice(0, 3).map((r) => r.nome)
    alvos.set(c.id, { cnpj: c.cnpj, nomes: [c.empresa, c.setup, ...daqui] })
  }
  return alvos
}

export async function runRadarNotify() {
  // Sem chave de e-mail o job não mexe na fila. Antes, cada envio virava 'falha' sem
  // tentativa nova: a fila inteira se perdia numa noite sem RESEND_API_KEY.
  if (!process.env.RESEND_API_KEY) {
    console.warn('[cron:radar-notify] RESEND_API_KEY não configurada — fila intacta')
    return { ok: true as const, skipped: true, motivo: 'RESEND_API_KEY não configurada' }
  }
  const inicio = Date.now()

  // 0) Envio interrompido: não sabemos se o Resend recebeu. Refazer arriscaria duplicar.
  await query(
    `UPDATE radar_notificacoes SET status = 'falha', erro = 'envio interrompido (worker reiniciado)'
      WHERE canal = 'email' AND status = 'enviando' AND enviado_em < now() - ($1 || ' minutes')::interval`,
    [String(ENVIANDO_ORFAO_MIN)],
  )

  // 1) Expira o velho. É também o que limpa os 25 mil acumulados na primeira rodada.
  const expirados = await query<{ n: number }>(
    `WITH x AS (
       UPDATE radar_notificacoes SET status = 'expirado', erro = 'mais de ${JANELA_FILA_H} h na fila sem envio'
        WHERE canal = 'email' AND status IN ('pendente', 'aguardando_resumo')
          AND criado_em < now() - interval '${JANELA_FILA_H} hours'
        RETURNING 1)
     SELECT count(*)::int AS n FROM x`,
  )

  // 2) Separa o pendente.
  const pendentes = await query<Pendente>(
    `SELECT n.id, n.titular_id, n.evento, n.destinatario, n.link,
            m.texto, m.autor, m.conector_id, m.categorias, m.prioridade,
            p.titulo AS proc_titulo, p.origem, p.participando
       FROM radar_notificacoes n
       LEFT JOIN radar_mensagens m ON m.id = n.mensagem_id
       LEFT JOIN radar_processos p ON p.id = n.processo_id
      WHERE n.canal = 'email' AND n.status = 'pendente'
      ORDER BY n.criado_em
      LIMIT ${LOTE}`,
  )
  const alvos = await carregarAlvos([...new Set(pendentes.map((p) => p.titular_id))])

  const paraResumo: string[] = []
  const agora: Pendente[] = []
  for (const n of pendentes) {
    const alvo = alvos.get(n.titular_id) ?? { cnpj: null, nomes: [] }
    if (entregaDe(n, alvo) === 'agora') agora.push(n)
    else paraResumo.push(n.id)
  }
  if (paraResumo.length) {
    await query(
      `UPDATE radar_notificacoes SET status = 'aguardando_resumo'
        WHERE id = ANY($1::text[]) AND status = 'pendente'`,
      [paraResumo],
    )
  }

  let enviados = 0, falhas = 0
  const porDestinatario = new Map<string, number>()
  for (const n of agora) {
    const ja = porDestinatario.get(n.destinatario) ?? 0
    if (ja >= TETO_AGORA_POR_DESTINATARIO) continue
    // Reivindica a linha antes de enviar: a rota manual pode rodar junto com o worker.
    const meu = await query<{ id: string }>(
      `UPDATE radar_notificacoes SET status = 'enviando', enviado_em = now()
        WHERE id = $1 AND status = 'pendente' RETURNING id`,
      [n.id],
    )
    if (!meu.length) continue
    porDestinatario.set(n.destinatario, ja + 1)

    let ok = false
    let motivo: string | undefined
    try {
      const r = await enviarAlertaRadar({
        to: n.destinatario, processo: n.proc_titulo ?? 'Processo monitorado',
        autor: n.autor, trecho: (n.texto ?? '').slice(0, 280), link: n.link ?? '',
        categorias: n.categorias ?? [],
        // Do CATÁLOGO, não de um ternário aqui: cinco portais além do Licitações-e
        // leem peça e não conversa, e um id cravado aqui os deixaria prometendo chat.
        fonte: leituraDoConector(n.conector_id),
      })
      ok = r.enviado; motivo = r.motivo
    } catch (e) { motivo = String(e) }

    if (ok) enviados++; else falhas++
    await query(
      `UPDATE radar_notificacoes
          SET status = $2, tentativas = tentativas + 1,
              enviado_em = CASE WHEN $2 = 'enviado' THEN enviado_em ELSE NULL END, erro = $3
        WHERE id = $1`,
      [n.id, ok ? 'enviado' : 'falha', ok ? null : (motivo ?? 'falha')],
    )
  }

  // 3) Escalonamento: alerta imediato enviado e não confirmado dentro do SLA.
  const escalonados = await query<{ id: string }>(
    `UPDATE radar_notificacoes
        SET escalonado_em = now()
      WHERE evento = 'nova_mensagem' AND status = 'enviado'
        AND confirmado_em IS NULL AND escalonado_em IS NULL
        AND enviado_em < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(SLA_ESCALONA_MIN)],
  )

  const resultado = {
    ok: true as const,
    expirados: expirados[0]?.n ?? 0,
    pendentes: pendentes.length,
    paraResumo: paraResumo.length,
    imediatos: agora.length,
    enviados, falhas,
    escalonados: escalonados.length,
  }
  if (resultado.expirados || resultado.pendentes) {
    console.log(`[cron:radar-notify] ${JSON.stringify(resultado)} em ${Date.now() - inicio}ms`)
  }
  return resultado
}
