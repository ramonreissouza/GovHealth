// src/app/api/stripe/webhook/route.ts — recebe eventos do Stripe (assinaturas).
// Verifica a assinatura HMAC do payload (STRIPE_WEBHOOK_SECRET) sobre o corpo CRU.
// Rota PÚBLICA (o middleware libera /api/stripe sem sessão nem rate-limit).
//
// Eventos tratados:
//  - checkout.session.completed   → ativa a assinatura + provisiona a conta + e-mail
//  - invoice.paid                 → mantém ativa (renovação recorrente)
//  - invoice.payment_failed       → marca inadimplente
//  - customer.subscription.deleted→ marca cancelada (suspende acesso)

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { ativarPorSession, atualizarStatusPorSubscription } from '@/lib/assinaturas'
import { provisionarPorAssinatura, marcarStatusAssinatura } from '@/lib/users'
import { enviarBoasVindas } from '@/lib/email'

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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session
        if (s.mode !== 'subscription') break
        const assinatura = await ativarPorSession(s.id, {
          customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null,
        })
        const email = assinatura?.email ?? s.customer_details?.email ?? s.metadata?.email
        if (email) {
          const prov = await provisionarPorAssinatura({
            email,
            nome: assinatura?.nome ?? s.customer_details?.name ?? s.metadata?.nome ?? null,
            plano: assinatura?.plano ?? s.metadata?.plano ?? 'pro',
            empresa: assinatura?.empresa ?? null,
            telefone: assinatura?.telefone ?? null,
            instituicao: assinatura?.instituicao ?? null,
            stripeCustomerId: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null,
          })
          await enviarBoasVindas({
            email,
            nome: assinatura?.nome ?? s.customer_details?.name ?? null,
            plano: assinatura?.plano ?? s.metadata?.plano ?? 'pro',
            senhaTemporaria: prov.senhaTemporaria,
          })
        }
        break
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice
        const subId = subscriptionIdDaInvoice(inv)
        if (subId) {
          const a = await atualizarStatusPorSubscription(subId, 'ativa')
          if (a?.email) await marcarStatusAssinatura(a.email, 'ativa')
        }
        break
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        const subId = subscriptionIdDaInvoice(inv)
        if (subId) {
          const a = await atualizarStatusPorSubscription(subId, 'inadimplente')
          if (a?.email) await marcarStatusAssinatura(a.email, 'inadimplente')
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const a = await atualizarStatusPorSubscription(sub.id, 'cancelada')
        if (a?.email) await marcarStatusAssinatura(a.email, 'cancelada')
        break
      }
      default:
        // Ignora silenciosamente os demais eventos.
        break
    }
  } catch (e) {
    // Retorna 200 mesmo com erro de processamento p/ evitar retries infinitos do
    // Stripe em falhas não recuperáveis; loga para investigação.
    console.error(`[stripe/webhook] erro processando ${event.type}:`, e)
  }

  return NextResponse.json({ received: true })
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
