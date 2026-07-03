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

export async function listarAssinaturas(limit = 100): Promise<Assinatura[]> {
  return query<Assinatura>(
    `SELECT id,nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,ciclo,metodo,
            valor::float8 AS valor, status, gateway_ref,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI') AS criado_em
     FROM assinaturas ORDER BY criado_em DESC LIMIT ${Math.min(limit, 500)}`,
  )
}

/** Marca que o checkout do Stripe foi iniciado (guarda a session e o customer). */
export async function marcarCheckoutIniciado(id: number, sessionId: string): Promise<void> {
  await query(
    `UPDATE assinaturas SET status='checkout', stripe_session_id=$2, gateway_ref=$2, atualizado_em=now()
     WHERE id=$1`,
    [id, sessionId],
  )
}

/** Ativa a assinatura ao concluir o checkout (webhook checkout.session.completed). */
export async function ativarPorSession(sessionId: string, refs: { customerId?: string | null; subscriptionId?: string | null }): Promise<Assinatura | null> {
  const r = await query<Assinatura>(
    `UPDATE assinaturas
        SET status='ativa', stripe_customer_id=$2, stripe_subscription_id=$3, atualizado_em=now()
      WHERE stripe_session_id=$1
      RETURNING id,nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,ciclo,metodo,
                valor::float8 AS valor, status, gateway_ref,
                to_char(criado_em,'YYYY-MM-DD"T"HH24:MI') AS criado_em`,
    [sessionId, refs.customerId ?? null, refs.subscriptionId ?? null],
  )
  return r[0] ?? null
}

/** Atualiza o status pela subscription do Stripe (invoice/cancelamento). */
export async function atualizarStatusPorSubscription(subscriptionId: string, status: 'ativa' | 'inadimplente' | 'cancelada'): Promise<Assinatura | null> {
  const r = await query<Assinatura>(
    `UPDATE assinaturas SET status=$2, atualizado_em=now()
      WHERE stripe_subscription_id=$1
      RETURNING id,nome,email,plano,status,stripe_customer_id`,
    [subscriptionId, status],
  )
  return (r[0] as Assinatura) ?? null
}

/** Assinatura por session (para a página de sucesso confirmar o estado). */
export async function assinaturaPorSession(sessionId: string): Promise<Pick<Assinatura, 'status' | 'plano' | 'email'> | null> {
  const r = await query<Pick<Assinatura, 'status' | 'plano' | 'email'>>(
    `SELECT status, plano, email FROM assinaturas WHERE stripe_session_id=$1 LIMIT 1`,
    [sessionId],
  )
  return r[0] ?? null
}
