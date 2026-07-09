// src/app/api/conta/portal/route.ts — abre o Portal de Cobrança do Stripe.
// POST → devolve a URL do portal (gerenciar cartão, faturas, trocar/cancelar plano).
// Requer Stripe configurado e um customer vinculado à conta.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { stripeCustomerIdDe } from '@/lib/users'
import { stripeConfigurado, criarPortalSession, appUrl } from '@/lib/stripe'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = ((t?.id as string | undefined) ?? (t?.sub as string | undefined))?.toLowerCase()
  if (!id) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  if (!stripeConfigurado()) {
    return NextResponse.json({ error: 'indisponivel', mensagem: 'Gestão de cobrança indisponível no momento.' }, { status: 503 })
  }
  const customerId = await stripeCustomerIdDe(id)
  if (!customerId) {
    return NextResponse.json({ error: 'sem_pagamento', mensagem: 'Nenhuma forma de pagamento vinculada a esta conta.' }, { status: 400 })
  }

  try {
    const url = await criarPortalSession(customerId, `${appUrl()}/conta`)
    if (!url) return NextResponse.json({ error: 'falha' }, { status: 502 })
    return NextResponse.json({ ok: true, url })
  } catch (e) {
    console.error('[conta/portal]', e)
    return NextResponse.json({ error: 'falha' }, { status: 502 })
  }
}
