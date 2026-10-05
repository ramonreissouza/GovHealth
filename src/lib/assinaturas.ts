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
}

/** Assinatura por session (para a página de sucesso confirmar o estado). */
export async function assinaturaPorSession(sessionId: string): Promise<EstadoDaSessao | null> {
  const r = await query<{ status: string; plano: string; email: string; conta_nova: boolean | null; boas_vindas_em: string | null; boas_vindas_enviado: boolean | null }>(
    `SELECT status, plano, email, conta_nova, boas_vindas_em, boas_vindas_enviado
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
  }
}
