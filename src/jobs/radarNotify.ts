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
//   3. REPASSA para OUTRA pessoa da equipe (quemEscala) o imediato que ninguém
//      confirmou ("Vi" no e-mail ou leitura na tela) em SLA_ESCALONA_MIN, e na hora o
//      imediato cujo envio falhou. Um repasse por aviso, com até TENTATIVAS_REPASSE.
//
// Estados de radar_notificacoes.status no e-mail:
//   pendente → enviando → enviado | falha          (imediato; também o repasse, evento 'escalonamento')
//   pendente → aguardando_resumo → resumindo → resumido   (resumo do dia)
//   pendente | aguardando_resumo → expirado         (passou de 48 h)
//   qualquer um → entregue                          (lido na tela antes; rota de mensagens)
// enviado_em no imediato é a hora da TENTATIVA, mesmo quando falha: é por ela que o
// repasse distingue o imediato que falhou do item do resumo que falhou (que não tem).
// confirmado_em é o "Vi" (src/app/api/radar/vi/route.ts) ou a leitura na tela.

import { query } from '@/lib/db'
import { enviarAlertaRadar } from '@/lib/email'
import { siteUrl } from '@/lib/site'
import { leituraDoConector } from '@/lib/radar/conectores'
import {
  entregaDe, quemEscala, IMEDIATO_MAX_H, JANELA_FILA_H, SLA_ESCALONA_MIN, ESCALONA_JANELA_H,
  type AlvoEmpresa, type MembroEquipe,
} from '@/lib/radar/entrega'
import { tokenVi } from '@/lib/radar/vi-token'
import { enviarPushPara } from '@/lib/push'

const LOTE = 500
/** Por destinatário e rodada. O que sobrar sai na próxima rodada, 5 min depois. */
const TETO_AGORA_POR_DESTINATARIO = 5
/** Envio que morreu no meio (worker reiniciado) não é refeito: vira falha, não duplica. */
const ENVIANDO_ORFAO_MIN = 15
/** Repasse que falha no envio é tentado de novo nas rodadas seguintes, até este total. */
const TENTATIVAS_REPASSE = 3

/** O que o e-mail de aviso precisa: a notificação, a mensagem e o pregão. */
interface Aviso {
  id: string; titular_id: string; destinatario: string; link: string | null
  texto: string | null; autor: string | null; conector_id: string | null
  categorias: string[] | null; horario_origem: string | Date | null
  proc_titulo: string | null; responsavel: string | null
}

interface Pendente extends Aviso {
  evento: string; prioridade: string | null; origem: string | null; participando: boolean | null
  idade_h: number
}

/** Imediato sem "Vi" (status 'enviado') ou que não chegou (status 'falha'). */
interface SemVi extends Aviso {
  status: 'enviado' | 'falha'
  /** Minutos desde a tentativa de envio. */
  minutos: number
  /** Pessoa indicada à mão (PATCH escalonar), preferida no repasse. */
  escalonado_para: string | null
}

const COLUNAS_AVISO = `n.id, n.titular_id, n.destinatario, n.link,
            m.texto, m.autor, m.conector_id, m.categorias, m.horario_origem,
            p.titulo AS proc_titulo, p.responsavel`

/** "02/10 às 14:05", no horário de Brasília: o e-mail diz QUANDO o pregoeiro escreveu. */
function horaBrasilia(valor: string | Date | null): string | null {
  if (!valor) return null
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return null
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? ''
  return `${v('day')}/${v('month')} às ${v('hour')}:${v('minute')}`
}

/** Link do botão "Vi". Sem NEXTAUTH_SECRET não há como assinar: o e-mail sai sem o botão. */
function linkVi(notificacaoId: string): string | null {
  try { return `${siteUrl()}/api/radar/vi?t=${tokenVi(notificacaoId)}` } catch { return null }
}

/**
 * Manda o aviso de `n` para `para`, por e-mail e por push (os aparelhos que a pessoa
 * ativou), registrando o resultado na linha `idLinha` (o próprio aviso, ou a linha do
 * repasse). Mesmo aviso nos dois casos; o repasse só acrescenta o porquê.
 *
 * Conta como entregue se QUALQUER canal entregou: com o push no celular, a pessoa pode
 * dar "Vi" pela notificação, e repassar na hora por causa do e-mail seria alarme falso.
 * A falha do e-mail fica em `erro` mesmo assim.
 */
async function enviarAviso(
  n: Aviso, idLinha: string, para: string,
  extra: { repassa?: boolean; repasse?: { de: string; minutos: number; falhou: boolean } },
): Promise<{ ok: boolean; push: number }> {
  const processo = n.proc_titulo ?? 'Processo monitorado'
  const vi = linkVi(idLinha)
  let emailOk = false
  let motivo: string | undefined
  try {
    const r = await enviarAlertaRadar({
      to: para, processo,
      autor: n.autor, trecho: (n.texto ?? '').slice(0, 280), link: n.link ?? '',
      categorias: n.categorias ?? [],
      quando: horaBrasilia(n.horario_origem),
      // Do CATÁLOGO, não de um ternário aqui: cinco portais além do Licitações-e
      // leem peça e não conversa, e um id cravado aqui os deixaria prometendo chat.
      fonte: leituraDoConector(n.conector_id),
      vi,
      ...extra,
    })
    emailOk = r.enviado; motivo = r.motivo
  } catch (e) { motivo = String(e) }

  const r = extra.repasse
  const push = await enviarPushPara(para, {
    titulo: r ? `${r.falhou ? '⚠️ Aviso não entregue' : '⚠️ Sem resposta'}: ${processo}` : `🔔 ${processo}`,
    corpo: `${n.autor ? `${n.autor}: ` : ''}${n.texto ?? ''}`,
    url: n.link || `${siteUrl()}/radar`,
    vi,
    tag: `radar-${idLinha}`,
    urgente: true,
  })

  const ok = emailOk || push.enviados > 0
  await query(
    `UPDATE radar_notificacoes SET status = $2, tentativas = tentativas + 1, erro = $3 WHERE id = $1`,
    [idLinha, ok ? 'enviado' : 'falha', emailOk ? null : (motivo ?? 'falha')],
  )
  return { ok, push: push.enviados }
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

/** As pessoas de cada conta (titular + membros), ativas, da mais antiga para a mais nova. */
async function carregarEquipes(titulares: string[]): Promise<Map<string, MembroEquipe[]>> {
  const equipes = new Map<string, MembroEquipe[]>()
  if (!titulares.length) return equipes
  const rows = await query<{ id: string; email: string; titular: boolean; dono: string }>(
    `SELECT id, email, titular_id IS NULL AS titular, coalesce(titular_id, id) AS dono
       FROM usuarios
      WHERE (id = ANY($1::text[]) OR titular_id = ANY($1::text[]))
        AND deleted_at IS NULL AND NOT suspenso
      ORDER BY criado_em, id`,
    [titulares],
  )
  for (const r of rows) {
    if (!equipes.has(r.dono)) equipes.set(r.dono, [])
    equipes.get(r.dono)!.push({ id: r.id, email: r.email, titular: r.titular })
  }
  return equipes
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
    `SELECT ${COLUNAS_AVISO}, n.evento, m.prioridade, p.origem, p.participando,
            EXTRACT(EPOCH FROM now() - n.criado_em)::float8 / 3600 AS idade_h
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
    if (entregaDe({ ...n, idadeHoras: n.idade_h }, alvo) === 'agora') agora.push(n)
    else paraResumo.push(n.id)
  }
  if (paraResumo.length) {
    await query(
      `UPDATE radar_notificacoes SET status = 'aguardando_resumo'
        WHERE id = ANY($1::text[]) AND status = 'pendente'`,
      [paraResumo],
    )
  }

  // Candidatos ao repasse (passo 3), lidos ANTES dos envios de agora: assim as equipes
  // saem de uma consulta só. O que for enviado nesta rodada ainda está dentro do SLA.
  //   'enviado' sem "Vi" depois do SLA, dentro da janela; 'falha' de imediato (tem
  //   enviado_em) dentro da janela, sem esperar: ninguém recebeu.
  // O limite em criado_em é o que usa o índice idx_radar_notif_repasse.
  const semVi = await query<SemVi>(
    `SELECT ${COLUNAS_AVISO}, n.status, n.escalonado_para,
            round(EXTRACT(EPOCH FROM now() - n.enviado_em) / 60)::int AS minutos
       FROM radar_notificacoes n
       LEFT JOIN radar_mensagens m ON m.id = n.mensagem_id
       LEFT JOIN radar_processos p ON p.id = n.processo_id
      WHERE n.canal = 'email' AND n.evento = 'nova_mensagem'
        AND n.confirmado_em IS NULL AND n.escalonado_em IS NULL
        AND n.criado_em > now() - ($3 || ' hours')::interval
        AND n.enviado_em > now() - ($2 || ' hours')::interval
        AND (n.status = 'falha' OR (n.status = 'enviado' AND n.enviado_em < now() - ($1 || ' minutes')::interval))
      ORDER BY n.enviado_em
      LIMIT ${LOTE}`,
    [String(SLA_ESCALONA_MIN), String(ESCALONA_JANELA_H), String(ESCALONA_JANELA_H + IMEDIATO_MAX_H)],
  )
  const equipes = await carregarEquipes([...new Set([...agora, ...semVi].map((n) => n.titular_id))])

  let enviados = 0, falhas = 0, push = 0
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
    const repassa = quemEscala({ destinatario: n.destinatario, responsavel: n.responsavel, equipe: equipes.get(n.titular_id) ?? [] }) != null
    const e = await enviarAviso(n, n.id, n.destinatario, { repassa })
    if (e.ok) enviados++; else falhas++
    push += e.push
  }

  // 3) Repasse.
  let repassados = 0, semEquipe = 0
  for (const n of semVi) {
    const para = quemEscala({
      destinatario: n.destinatario, preferido: n.escalonado_para, responsavel: n.responsavel,
      equipe: equipes.get(n.titular_id) ?? [],
    })
    // Reivindica antes de enviar (a rota manual pode rodar junto): um repasse por aviso.
    const meu = await query<{ id: string }>(
      `UPDATE radar_notificacoes SET escalonado_em = now(), escalonado_para = $2
        WHERE id = $1 AND escalonado_em IS NULL AND confirmado_em IS NULL RETURNING id`,
      [n.id, para?.email ?? null],
    )
    if (!meu.length) continue
    if (!para) { semEquipe++; continue } // equipe de uma pessoa: só marca

    // A linha do repasse é criada uma vez; se o envio dela falhou numa rodada anterior,
    // volta para 'enviando' aqui, até TENTATIVAS_REPASSE.
    const idRepasse = `esc:${n.id}`
    const vez = await query<{ id: string; tentativas: number }>(
      `INSERT INTO radar_notificacoes (id, titular_id, evento, mensagem_id, processo_id, destinatario, canal, assunto, link, status, enviado_em)
       SELECT $1, titular_id, 'escalonamento', mensagem_id, processo_id, $2, 'email', assunto, link, 'enviando', now()
         FROM radar_notificacoes WHERE id = $3
       ON CONFLICT (id) DO UPDATE SET status = 'enviando', enviado_em = now(), destinatario = EXCLUDED.destinatario
         WHERE radar_notificacoes.status = 'falha' AND radar_notificacoes.tentativas < ${TENTATIVAS_REPASSE}
       RETURNING id, tentativas`,
      [idRepasse, para.email, n.id],
    )
    if (!vez.length) continue

    const { ok, push: p } = await enviarAviso(n, idRepasse, para.email, {
      repasse: { de: n.destinatario, minutos: n.minutos, falhou: n.status === 'falha' },
    })
    push += p
    if (ok) repassados++
    else {
      falhas++
      // Sem nova chance esgotada, devolve o aviso à fila do repasse para a próxima rodada
      // (a janela de ESCALONA_JANELA_H ainda limita). Mantém quem foi indicado à mão.
      if (vez[0].tentativas + 1 < TENTATIVAS_REPASSE) {
        await query(
          `UPDATE radar_notificacoes SET escalonado_em = NULL, escalonado_para = $2 WHERE id = $1`,
          [n.id, n.escalonado_para],
        )
      }
    }
    await query(
      `INSERT INTO radar_auditoria (titular_id, acao, entidade, entidade_id, detalhe)
       VALUES ($1, 'escalonamento', 'radar_notificacoes', $2, $3::jsonb)`,
      [n.titular_id, n.id, JSON.stringify({ para: para.email, automatico: true, enviado: ok, original_falhou: n.status === 'falha' })],
    )
  }

  const resultado = {
    ok: true as const,
    expirados: expirados[0]?.n ?? 0,
    pendentes: pendentes.length,
    paraResumo: paraResumo.length,
    imediatos: agora.length,
    enviados, falhas,
    repassados, semEquipe,
    push,
  }
  if (resultado.expirados || resultado.pendentes || semVi.length) {
    console.log(`[cron:radar-notify] ${JSON.stringify(resultado)} em ${Date.now() - inicio}ms`)
  }
  return resultado
}
