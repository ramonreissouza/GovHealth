// src/app/api/stripe/webhook/route.ts — recebe eventos do Stripe (assinaturas).
// Verifica a assinatura HMAC do payload (STRIPE_WEBHOOK_SECRET) sobre o corpo CRU.
// Rota PÚBLICA (o middleware libera /api/stripe sem sessão nem rate-limit).
//
// Eventos tratados:
//  - checkout.session.completed    → ativa a assinatura + provisiona a conta + boas-vindas
//  - invoice.paid                  → reconcilia com o estado atual no Stripe
//  - invoice.payment_failed        → idem (e avisa o cliente se virou inadimplente)
//  - customer.subscription.deleted → idem (cancelada suspende o acesso)
//
// ENTREGA CONFIÁVEL (revisão da #63). O Stripe entrega "pelo menos uma vez" e só tenta
// de novo quando a resposta não é 2xx. Até aqui este handler devolvia 200 até em erro,
// então uma falha no meio (banco fora, e-mail fora) deixava cliente pago sem conta, sem
// retry; e um reenvio manual repetia ativação e e-mails. Agora:
//  - cada event.id é reivindicado em stripe_eventos antes de processar: evento já
//    processado responde 200 sem efeito, e duas entregas simultâneas não rodam juntas;
//  - qualquer falha responde 500 e solta a trava, para o Stripe reenviar;
//  - cada passo do checkout olha o estado GRAVADO (conta_nova, boas_vindas_enviado)
//    antes de agir, então o reprocessamento retoma de onde parou em vez de repetir;
//  - fatura e cancelamento não confiam na ordem de chegada: consultam a assinatura no
//    Stripe e aplicam o estado ATUAL dela.

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import {
  ativarPorSession, atualizarStatusPorSubscription, registrarContaNova, registrarBoasVindas,
  type StatusAssinatura,
} from '@/lib/assinaturas'
import { provisionarPorAssinatura, marcarStatusAssinatura } from '@/lib/users'
import { criarLinkDefinirSenha, BOAS_VINDAS_LINK_HORAS } from '@/lib/seguranca'
import { enviarBoasVindas, enviarPagamentoFalhou, enviarAssinaturaCancelada } from '@/lib/email'
import { reivindicarEvento, concluirEvento, falharEvento } from '@/lib/stripe-eventos'

export const runtime = 'nodejs'
// Precisamos do corpo CRU para validar a assinatura — não deixar o Next parsear.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET ausente')
    return NextResponse.json({ error: 'webhook não configurado' }, { status: 503 })
  }

  const sig = req.headers.get('stripe-signature')
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(raw, sig ?? '', secret)
  } catch (e) {
    console.warn('[stripe/webhook] assinatura inválida:', e)
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 400 })
  }

  const vez = await reivindicarEvento(event.id, event.type)
  if (vez === 'ja-processado') return NextResponse.json({ received: true, duplicado: true })
  // Outra entrega do MESMO evento está processando agora. 409 não é 2xx: o Stripe tenta
  // de novo mais tarde, e aí ou já terminou (200 acima) ou a trava expirou.
  if (vez === 'em-andamento') return NextResponse.json({ error: 'evento em processamento' }, { status: 409 })

  try {
    await processar(event)
    await concluirEvento(event.id)
    return NextResponse.json({ received: true })
  } catch (e) {
    console.error(`[stripe/webhook] erro processando ${event.type} (${event.id}):`, e)
    await falharEvento(event.id, e).catch((e2) => console.error('[stripe/webhook] falharEvento:', e2))
    // 500 de propósito: o Stripe reenvia com espera crescente, e o reprocessamento é
    // seguro (ver o cabeçalho).
    return NextResponse.json({ error: 'falha ao processar; o Stripe vai reenviar' }, { status: 500 })
  }
}

async function processar(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await checkoutConcluido(event.data.object as Stripe.Checkout.Session)
      return
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = subscriptionIdDaInvoice(event.data.object as Stripe.Invoice)
      if (subId) await reconciliar(subId, { avisarFalha: event.type === 'invoice.payment_failed' })
      return
    }
    case 'customer.subscription.deleted':
      await reconciliar((event.data.object as Stripe.Subscription).id, {})
      return
    default:
      // Os demais eventos não interessam (o endpoint assina só os quatro acima).
      return
  }
}

/**
 * Checkout pago: ativa, provisiona a conta e manda as boas-vindas. Cada etapa confere
 * o estado gravado antes de agir, para que um reprocessamento (retry do Stripe depois
 * de falha) retome de onde parou: não reprovisiona e não reenvia o que já foi enviado.
 */
async function checkoutConcluido(s: Stripe.Checkout.Session): Promise<void> {
  if (s.mode !== 'subscription') return
  if (s.status !== 'complete' || (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required')) return

  const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null
  const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null

  const a = await ativarPorSession(s.id, { customerId, subscriptionId })
  if (!a) {
    // Nosso checkout sempre grava a assinatura antes de criar a sessão. Sessão sem linha
    // não saiu do /assinar: não há o que ativar, e reprocessar não muda isso.
    console.error('[stripe/webhook] checkout concluído sem assinatura local', { session: s.id })
    return
  }
  if (a.status !== 'ativa') {
    console.warn('[stripe/webhook] checkout concluído para assinatura que não está pendente', { assinatura: a.id, status: a.status })
    return
  }

  // A ordem dos eventos não é garantida: se a assinatura já foi cancelada ou ficou
  // inadimplente no Stripe antes deste evento chegar, vale o estado de lá.
  if (subscriptionId) {
    const atual = await reconciliar(subscriptionId, { silencioso: true })
    if (atual && atual !== 'ativa') return
  }

  let contaNova = a.conta_nova ?? null
  if (contaNova === null) {
    const prov = await provisionarPorAssinatura({
      email: a.email, nome: a.nome, plano: a.plano,
      empresa: a.empresa, telefone: a.telefone, instituicao: a.instituicao,
      stripeCustomerId: customerId,
    })
    contaNova = prov.criada
    // Gravado ANTES do e-mail: num retry a conta já existe, e é isto que lembra que ela
    // era nova e ainda precisa do link de senha.
    await registrarContaNova(a.id, contaNova)
  }

  if (a.boas_vindas_enviado) return // entrega anterior já enviou

  // Link novo a cada tentativa: emitir outro invalida o anterior, que nunca chegou.
  const linkDefinirSenha = contaNova ? await criarLinkDefinirSenha(a.email) : undefined
  const envio = await enviarBoasVindas({
    email: a.email, nome: a.nome, plano: a.plano,
    linkDefinirSenha, validadeLinkHoras: BOAS_VINDAS_LINK_HORAS,
  })
  await registrarBoasVindas(a.id, { contaNova, enviado: envio.enviado, erro: envio.motivo })

  if (!envio.enviado) {
    console.error('[stripe/webhook] boas-vindas NÃO enviada', { assinatura: a.id, contaNova, motivo: envio.motivo })
    // Conta nova sem o e-mail = cliente que pagou e não tem como entrar. Falha o evento
    // para o Stripe reenviar. Conta que já existia entra com a senha de sempre: o e-mail
    // é só confirmação, e não vale segurar o evento por ele.
    if (contaNova) throw new Error(`boas-vindas não enviada (conta nova): ${envio.motivo ?? 'motivo desconhecido'}`)
  }
}

/**
 * Aplica à assinatura local o estado ATUAL da subscription no Stripe — não o que o evento
 * sugere, porque eventos podem chegar fora de ordem. Avisa o cliente só quando houve
 * transição, para dois eventos que levam ao mesmo estado não mandarem dois e-mails.
 * Devolve o status aplicado, ou null se a subscription ainda não está ligada a nenhuma
 * assinatura local (o checkout dela ainda não foi processado; ele mesmo reconcilia).
 */
async function reconciliar(subscriptionId: string, opts: { avisarFalha?: boolean; silencioso?: boolean })
  : Promise<StatusAssinatura | null> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId)
  const status = statusLocal(sub.status)
  const a = await atualizarStatusPorSubscription(subscriptionId, status)
  if (!a) return null
  await marcarStatusAssinatura(a.email, status)

  if (!opts.silencioso && a.status_anterior !== status) {
    // Aviso é notificação, não estado: se o e-mail falhar, o status já está certo, e
    // segurar o evento por isso reenviaria o mesmo aviso depois.
    if (status === 'inadimplente' && opts.avisarFalha) {
      await enviarPagamentoFalhou({ email: a.email, nome: a.nome, plano: a.plano })
    } else if (status === 'cancelada') {
      await enviarAssinaturaCancelada({ email: a.email, nome: a.nome, plano: a.plano })
    }
  }
  return status
}

/** Status da subscription no Stripe → status da assinatura local. */
function statusLocal(s: Stripe.Subscription.Status): StatusAssinatura {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'ativa'
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelada'
    default:
      // past_due, unpaid, incomplete, paused: cobrança pendente.
      return 'inadimplente'
  }
}

// A subscription pode vir em campos diferentes conforme a versão da API.
function subscriptionIdDaInvoice(inv: Stripe.Invoice): string | null {
  const anyInv = inv as unknown as { subscription?: string | { id: string } | null; parent?: { subscription_details?: { subscription?: string | { id: string } } } }
  const direto = anyInv.subscription
  if (typeof direto === 'string') return direto
  if (direto && typeof direto === 'object') return direto.id
  const viaParent = anyInv.parent?.subscription_details?.subscription
  if (typeof viaParent === 'string') return viaParent
  if (viaParent && typeof viaParent === 'object') return viaParent.id
  return null
}
