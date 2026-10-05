// src/lib/assinaturas.ts — intenções de assinatura vindas do checkout público.
// A cobrança real é de um gateway (Asaas/Iugu/Pagar.me/Stripe) — aqui só a
// INTENÇÃO/pendência até a integração. NENHUM dado de cartão é armazenado.
import { query } from '@/lib/db'

export interface Assinatura {
  id: number; nome: string | null; email: string; empresa: string | null; instituicao: string | null
  cpf_cnpj: string | null; telefone: string | null; endereco: string | null
  plano: string; ciclo: string | null; metodo: string | null; valor: number | null
  status: string; criado_em: string
  gateway_ref?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null
  /** Estado das boas-vindas (ver registrarContaNova / registrarBoasVindas). */
  conta_nova?: boolean | null; boas_vindas_enviado?: boolean | null
}

export async function criarAssinatura(d: {
  nome?: string; email: string; empresa?: string; instituicao?: string; cpf_cnpj?: string
  telefone?: string; endereco?: string; plano: string; metodo?: string; valor?: number
}): Promise<number> {
  const r = await query<{ id: number }>(
    `INSERT INTO assinaturas (nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,metodo,valor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [d.nome ?? null, d.email, d.empresa ?? null, d.instituicao ?? null, d.cpf_cnpj ?? null,
     d.telefone ?? null, d.endereco ?? null, d.plano, d.metodo ?? null, d.valor ?? null],
  )
  return r[0]?.id
}

/**
 * Grava o ACEITE dos Termos e da Privacidade na assinatura: versão de cada documento, o
 * instante (do servidor, não do navegador) e o IP de quem aceitou. É a evidência de qual
 * texto acompanhou a contratação (revisão da #45; colunas em migrate-aceite-termos.mjs).
 *
 * Em separado do INSERT de propósito: se o código novo subir antes da migration (a
 * Vercel publica no push, o deploy aplica o schema), a coluna ainda não existe (42703).
 * Aí o erro fica no log, bem visível, e o pagamento NÃO é barrado — perder o cliente por
 * uma coluna que chega em minutos seria pior. Qualquer outro erro sobe.
 */
export async function registrarAceite(id: number, a: { termosVersao: string; privacidadeVersao: string; ip: string | null }): Promise<void> {
  try {
    await query(
      `UPDATE assinaturas SET termos_versao = $2, privacidade_versao = $3, aceite_em = now(), aceite_ip = $4 WHERE id = $1`,
      [id, a.termosVersao, a.privacidadeVersao, a.ip],
    )
  } catch (e) {
    if ((e as { code?: string })?.code === '42703') {
      console.error(`[aceite] migração pendente (npm run aceite:migrate): aceite da assinatura ${id} NÃO gravado`, a)
      return
    }
    throw e
  }
}

/** A frase do aceite recusado (versão antiga ou ausente), para a tela mostrar em vez de "Dados inválidos". */
export function erroDeAceite(err: { issues: { path: PropertyKey[]; message: string }[] }): string | null {
  const i = err.issues.find((x) => x.path[0] === 'termosVersao' || x.path[0] === 'privacidadeVersao')
  return i ? i.message : null
}

/** O IP de quem fez a requisição, do primeiro salto do proxy (nginx/Vercel). */
export function ipDaRequisicao(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (xff || headers.get('x-real-ip') || '').slice(0, 64) || null
}

export async function listarAssinaturas(limit = 100): Promise<Assinatura[]> {
  return query<Assinatura>(
    `SELECT id,nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,ciclo,metodo,
            valor::float8 AS valor, status, gateway_ref,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI') AS criado_em
     FROM assinaturas ORDER BY criado_em DESC LIMIT ${Math.min(limit, 500)}`,
  )
}

/**
 * Marca que o checkout do Stripe foi iniciado: guarda a session e o HASH do cookie de
 * correlação da página de sucesso (o valor do cookie nunca é gravado).
 */
export async function marcarCheckoutIniciado(id: number, sessionId: string, nonceHash: string): Promise<void> {
  await query(
    `UPDATE assinaturas SET status='checkout', stripe_session_id=$2, gateway_ref=$2, checkout_nonce_hash=$3, atualizado_em=now()
     WHERE id=$1`,
    [id, sessionId, nonceHash],
  )
}

/**
 * Ativa a assinatura ao concluir o checkout (webhook checkout.session.completed).
 *
 * Só PROMOVE quem ainda estava pendente ou em checkout: uma assinatura que já foi para
 * inadimplente ou cancelada por evento posterior não volta a 'ativa' por causa de um
 * checkout antigo. Devolve a linha mesmo sem mudar nada, com o status real — o webhook
 * segue só se ele for 'ativa' — e o estado das boas-vindas, que é o que torna o resto
 * do processamento repetível.
 */
export async function ativarPorSession(sessionId: string, refs: { customerId?: string | null; subscriptionId?: string | null }): Promise<Assinatura | null> {
  const r = await query<Assinatura>(
    `UPDATE assinaturas
        SET status = CASE WHEN status IN ('pendente','checkout') THEN 'ativa' ELSE status END,
            stripe_customer_id = COALESCE(stripe_customer_id, $2),
            stripe_subscription_id = COALESCE(stripe_subscription_id, $3),
            atualizado_em = now()
      WHERE stripe_session_id=$1
      RETURNING id,nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,ciclo,metodo,
                valor::float8 AS valor, status, gateway_ref, conta_nova, boas_vindas_enviado,
                to_char(criado_em,'YYYY-MM-DD"T"HH24:MI') AS criado_em`,
    [sessionId, refs.customerId ?? null, refs.subscriptionId ?? null],
  )
  return r[0] ?? null
}

export type StatusAssinatura = 'ativa' | 'inadimplente' | 'cancelada'

/**
 * Aplica o status pela subscription do Stripe (fatura/cancelamento) e devolve também o
 * status ANTERIOR. Quem chama manda e-mail só quando houve transição — dois eventos que
 * levam ao mesmo estado não avisam o cliente duas vezes.
 */
export async function atualizarStatusPorSubscription(subscriptionId: string, status: StatusAssinatura)
  : Promise<(Pick<Assinatura, 'id' | 'nome' | 'email' | 'plano' | 'status'> & { status_anterior: string }) | null> {
  const r = await query<Pick<Assinatura, 'id' | 'nome' | 'email' | 'plano' | 'status'> & { status_anterior: string }>(
    `WITH antes AS (
       SELECT id, status FROM assinaturas WHERE stripe_subscription_id=$1 FOR UPDATE
     )
     UPDATE assinaturas a SET status=$2, atualizado_em=now()
       FROM antes WHERE a.id = antes.id
     RETURNING a.id, a.nome, a.email, a.plano, a.status, antes.status AS status_anterior`,
    [subscriptionId, status],
  )
  return r[0] ?? null
}

/**
 * Grava se o provisionamento criou a conta agora. Fica gravado ANTES do e-mail: se o
 * envio falhar e o Stripe reenviar o evento, a conta já existe e o provisionamento diria
 * "não é nova" — é esta coluna que lembra que ela era, e que o link de senha ainda deve.
 */
export async function registrarContaNova(id: number, contaNova: boolean): Promise<void> {
  await query(`UPDATE assinaturas SET conta_nova=$2, atualizado_em=now() WHERE id=$1`, [id, contaNova])
}

/**
 * Grava o que aconteceu depois da ativação: se a conta foi criada agora e se o e-mail de
 * boas-vindas saiu. É o que deixa a página de sucesso dizer a verdade — e o admin achar
 * quem pagou e ficou sem a senha.
 */
export async function registrarBoasVindas(id: number, r: { contaNova: boolean; enviado: boolean; erro?: string | null }): Promise<void> {
  await query(
    `UPDATE assinaturas
        SET conta_nova=$2, boas_vindas_em=now(), boas_vindas_enviado=$3, boas_vindas_erro=$4, atualizado_em=now()
      WHERE id=$1`,
    [id, r.contaNova, r.enviado, r.enviado ? null : (r.erro ?? 'motivo desconhecido').slice(0, 500)],
  )
}

export interface EstadoDaSessao {
  status: string; plano: string; email: string
  /** null = o webhook ainda não terminou as boas-vindas. */
  contaNova: boolean | null; emailEnviado: boolean | null
  /** Hash do cookie do checkout: quem não o tem só vê o status. */
  nonceHash: string | null
}

/** Assinatura por session (para a página de sucesso confirmar o estado). */
export async function assinaturaPorSession(sessionId: string): Promise<EstadoDaSessao | null> {
  const r = await query<{ status: string; plano: string; email: string; conta_nova: boolean | null; boas_vindas_em: string | null; boas_vindas_enviado: boolean | null; checkout_nonce_hash: string | null }>(
    `SELECT status, plano, email, conta_nova, boas_vindas_em, boas_vindas_enviado, checkout_nonce_hash
       FROM assinaturas WHERE stripe_session_id=$1 LIMIT 1`,
    [sessionId],
  )
  const a = r[0]
  if (!a) return null
  const terminou = a.boas_vindas_em != null
  return {
    status: a.status, plano: a.plano, email: a.email,
    contaNova: terminou ? a.conta_nova : null,
    emailEnviado: terminou ? a.boas_vindas_enviado : null,
    nonceHash: a.checkout_nonce_hash,
  }
}
