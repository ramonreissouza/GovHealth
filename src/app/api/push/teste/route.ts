// src/app/api/push/teste/route.ts — "Enviar aviso de teste" da tela de configurações:
// manda um push para todos os aparelhos ativos de quem clicou.

import { NextRequest, NextResponse } from 'next/server'
import { tenantDe } from '@/lib/radar/db'
import { enviarPushPara, pushConfigurado } from '@/lib/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  if (!pushConfigurado()) return NextResponse.json({ error: 'aviso no celular ainda não ligado no servidor' }, { status: 503 })
  const r = await enviarPushPara(t.userId, {
    titulo: 'GovHealth: aviso de teste',
    corpo: 'Se você está vendo isto, a convocação chega neste aparelho.',
    url: '/radar/configuracoes',
    tag: 'teste',
  })
  return NextResponse.json({ ok: true, ...r })
}
