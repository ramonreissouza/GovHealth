// src/lib/stripe.ts — cliente Stripe (server-only) + resolução de preço por plano.
// PCI-safe: o cartão é coletado no Checkout HOSPEDADO do Stripe (tokenizado);
// nunca passa pelos nossos servidores. Cobrança recorrente automática (cartão).
//
// Preço do plano, por STRIPE_PRICE_ESSENCIAL / STRIPE_PRICE_PRO:
//  - `price_…` → usa esse Price direto;
//  - `prod_…`  → usa o PREÇO PADRÃO do produto, conferido contra src/lib/planos.ts
//    (BRL, mensal, mesmo valor) — divergiu, o checkout recusa em vez de cobrar
//    diferente do que a tela anuncia;
//  - vazio     → cria o preço inline (price_data com recurring) — funciona sem
//    pré-cadastrar produtos no Stripe.

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

/** Price ou Product ID configurado para o plano (se houver). */
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

const reais = (centavos: number | null | undefined) =>
  centavos == null ? '(sem valor)' : `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`

/**
 * Preço padrão do produto, só se for o que a tela anuncia: ativo, BRL, mensal e com o
 * valor de planos.ts. O valor cobrado vem do Stripe; sem esta conferência, mudar o
 * preço no Dashboard (ou cadastrar o anual como padrão) cobraria outra coisa calado.
 */
async function precoPadraoDoProduto(productId: string, plano: Plano): Promise<string> {
  const produto = await getStripe().products.retrieve(productId, { expand: ['default_price'] })
  const p = produto.default_price
  const erro = (motivo: string) => new Error(`${productId} (plano ${plano.id}): ${motivo}`)
  if (!p || typeof p === 'string') throw erro('produto sem preço padrão')
  if (!p.active) throw erro(`preço padrão ${p.id} está inativo`)
  if (p.type !== 'recurring' || p.recurring?.interval !== 'month' || p.recurring.interval_count !== 1) {
    throw erro(`preço padrão ${p.id} não é recorrente mensal`)
  }
  if (p.currency !== 'brl') throw erro(`preço padrão ${p.id} em ${p.currency}, esperado brl`)
  const esperado = Math.round(plano.preco * 100)
  if (p.unit_amount !== esperado) {
    throw erro(`preço padrão ${p.id} é ${reais(p.unit_amount)}, o plano anuncia ${reais(esperado)}`)
  }
  return p.id
}

/**
 * line_item de assinatura mensal p/ o Checkout. Usa o Price (ou o preço padrão do
 * Product) se configurado, senão cria o preço inline (BRL, recorrente mensal).
 */
export async function lineItemDoPlano(plano: Plano): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  const id = priceIdDe(plano)?.trim()
  if (id?.startsWith('price_')) return { price: id, quantity: 1 }
  if (id?.startsWith('prod_')) return { price: await precoPadraoDoProduto(id, plano), quantity: 1 }
  if (id) throw new Error(`STRIPE_PRICE_${plano.id.toUpperCase()} deve começar com price_ ou prod_`)
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
