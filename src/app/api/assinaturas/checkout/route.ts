// src/app/api/assinaturas/checkout/route.ts — inicia a assinatura por CARTÃO via
// Stripe EMBEDDED Checkout (PCI-safe, cobrança recorrente automática). O cartão é
// preenchido dentro da própria página da GovHealth (iframe do Stripe) — sem sair
// do site. Rota PÚBLICA. Registra a pendência, cria a sessão e devolve o
// client_secret que o front usa para montar o checkout embutido.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { criarAssinatura, marcarCheckoutIniciado } from '@/lib/assinaturas'
import { planoPorId } from '@/lib/planos'
import { getStripe, stripeConfigurado, lineItemDoPlano, appUrl } from '@/lib/stripe'

export const runtime = 'nodejs'

const Schema = z.object({
  nome: z.string().min(1).max(120),
  email: z.string().email(),
  empresa: z.string().max(160).optional(),
  instituicao: z.string().max(160).optional(),
  cpfCnpj: z.string().max(20).optional(),
  telefone: z.string().max(40).optional(),
  endereco: z.string().max(240).optional(),
  plano: z.enum(['essencial', 'pro']),
})

export async function POST(req: NextRequest) {
  try {
    if (!stripeConfigurado()) {
      return NextResponse.json({ error: 'Pagamento por cartão indisponível no momento. Tente PIX/Boleto.' }, { status: 503 })
    }
    const parsed = Schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos', detalhes: parsed.error.flatten() }, { status: 400 })
    const d = parsed.data
    const plano = planoPorId(d.plano)!

    // 1) registra a pendência (auditoria/lead) e obtém o id interno
    const assinaturaId = await criarAssinatura({
      nome: d.nome, email: d.email, empresa: d.empresa, instituicao: d.instituicao,
      cpf_cnpj: d.cpfCnpj, telefone: d.telefone, endereco: d.endereco,
      plano: d.plano, metodo: 'cartao', valor: plano.preco,
    })

    // 2) cria a sessão de checkout EMBUTIDO (assinatura recorrente). Com ui_mode
    //    'embedded' usamos return_url (não success_url/cancel_url).
    const stripe = getStripe()
    const base = appUrl()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      payment_method_types: ['card'],
      line_items: [lineItemDoPlano(plano)],
      customer_email: d.email,
      locale: 'pt-BR',
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      client_reference_id: String(assinaturaId),
      metadata: { assinatura_id: String(assinaturaId), plano: d.plano, email: d.email, nome: d.nome ?? '' },
      subscription_data: {
        metadata: { assinatura_id: String(assinaturaId), plano: d.plano, email: d.email },
      },
      return_url: `${base}/assinar/sucesso?session_id={CHECKOUT_SESSION_ID}`,
    })

    // 3) guarda a referência da sessão
    await marcarCheckoutIniciado(assinaturaId, session.id)

    return NextResponse.json({ ok: true, clientSecret: session.client_secret })
  } catch (e) {
    console.error('[assinaturas/checkout]', e)
    return NextResponse.json({ error: 'Não foi possível iniciar o pagamento.' }, { status: 500 })
  }
}
