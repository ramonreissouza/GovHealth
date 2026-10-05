// src/lib/stripe-eventos.ts — cada evento do webhook do Stripe é processado UMA vez.
//
// O Stripe entrega "pelo menos uma vez": reenvia quando a resposta não é 2xx e permite
// reenvio manual pelo Dashboard. Sem registro do event.id, um reenvio repetia ativação,
// provisionamento e e-mails (revisão da #63).
//
// Ciclo de um evento:
//   reivindicarEvento → 'processar'      : esta entrega é a dona; processa.
//                     → 'ja-processado'  : responde 200 sem fazer nada.
//                     → 'em-andamento'   : outra entrega está processando agora; responde
//                                          409 e o Stripe tenta de novo mais tarde.
//   concluirEvento    : terminou bem; marca processado.
//   falharEvento      : deu erro; solta a trava e guarda o erro. O webhook responde 5xx,
//                       o Stripe reenvia, e a próxima entrega reivindica de novo.
//
// A trava (`processando_ate`) expira sozinha: se o processo morrer no meio, a próxima
// entrega depois do prazo assume.

import { query, queryOne } from '@/lib/db'

/** Quanto tempo uma entrega pode segurar o evento antes de outra poder assumir. */
const TRAVA_SEGUNDOS = 120

export type Reivindicacao = 'processar' | 'ja-processado' | 'em-andamento'

export async function reivindicarEvento(id: string, tipo: string): Promise<Reivindicacao> {
  const dono = await query<{ id: string }>(
    `INSERT INTO stripe_eventos (id, tipo, processando_ate)
          VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (id) DO UPDATE
          SET tentativas = stripe_eventos.tentativas + 1,
              processando_ate = now() + make_interval(secs => $3)
        WHERE stripe_eventos.processado_em IS NULL
          AND (stripe_eventos.processando_ate IS NULL OR stripe_eventos.processando_ate < now())
     RETURNING id`,
    [id, tipo, TRAVA_SEGUNDOS],
  )
  if (dono.length) return 'processar'
  const atual = await queryOne<{ processado_em: string | null }>(
    `SELECT processado_em FROM stripe_eventos WHERE id = $1`, [id])
  return atual?.processado_em ? 'ja-processado' : 'em-andamento'
}

export async function concluirEvento(id: string): Promise<void> {
  await query(
    `UPDATE stripe_eventos SET processado_em = now(), processando_ate = NULL, ultimo_erro = NULL WHERE id = $1`,
    [id],
  )
}

export async function falharEvento(id: string, erro: unknown): Promise<void> {
  await query(
    `UPDATE stripe_eventos SET processando_ate = NULL, ultimo_erro = $2 WHERE id = $1`,
    [id, String(erro instanceof Error ? erro.message : erro).slice(0, 1000)],
  )
}
