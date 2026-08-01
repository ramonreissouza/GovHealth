// src/lib/stripe.ts — cliente Stripe (server-only) + resolução de preço por plano.
// PCI-safe: o cartão é coletado no Checkout HOSPEDADO do Stripe (tokenizado);
// nunca passa pelos nossos servidores. Cobrança recorrente automática (cartão).
//
// Preço do plano: usa o Price ID do Stripe se configurado em env
// (STRIPE_PRICE_ESSENCIAL / STRIPE_PRICE_PRO); senão, cria o preço inline
// (price_data com recurring) — funciona sem pré-cadastrar produtos no Stripe.

import Stripe from 'stripe'
import { type Plano } from '@/lib/planos'
import { siteUrl } from '@/lib/site'

let _stripe: Stripe | null = null

/** Cliente Stripe lazy (não instancia no import — build não exige a chave). */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY não configurada')
    _stripe = new Stripe(key)
  }
  return _stripe
}

export function stripeConfigurado(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/** URL base pública p/ success/cancel, e-mails e OG. Domínio canônico (lib/site). */
export function appUrl(): string {
  return siteUrl()
}

/** Price ID configurado para o plano (se houver). */
function priceIdDe(plano: Plano): string | undefined {
  const map: Record<Plano['id'], string | undefined> = {
    essencial: process.env.STRIPE_PRICE_ESSENCIAL,
    pro: process.env.STRIPE_PRICE_PRO,
    empresa: process.env.STRIPE_PRICE_EMPRESA,   // sob consulta — normalmente sem checkout self-service
  }
  return map[plano.id]
}

/**
 * Sessão do Portal de Cobrança do Stripe: o cliente gerencia o próprio cartão,
 * vê faturas, troca de plano e cancela a assinatura — tudo hospedado (PCI-safe).
 * Retorna a URL para redirecionar. Requer um customer do Stripe vinculado.
 */
export async function criarPortalSession(customerId: string, returnUrl: string): Promise<string | null> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
  return session.url ?? null
}

/**
 * line_item de assinatura mensal p/ o Checkout. Usa Price ID se configurado,
 * senão cria o preço inline (BRL, recorrente mensal).
 */
export function lineItemDoPlano(plano: Plano): Stripe.Checkout.SessionCreateParams.LineItem {
  const priceId = priceIdDe(plano)
  if (priceId) return { price: priceId, quantity: 1 }
  return {
    quantity: 1,
    price_data: {
      currency: 'brl',
      unit_amount: Math.round(plano.preco * 100),
      recurring: { interval: 'month' },
      product_data: { name: `GovHealth.ai — Plano ${plano.nome}` },
    },
  }
}
