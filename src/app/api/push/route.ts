// src/app/api/push/route.ts — inscrição do aparelho no aviso por push (src/lib/push.ts).
//   GET    → servidor tem push? chave pública VAPID e os aparelhos ativos da pessoa
//   POST   → ativa este aparelho  { subscription: PushSubscriptionJSON, aparelho?: string,
//            substitui?: endpoint antigo, na renovação }
//   DELETE → desativa este aparelho { endpoint }
// A inscrição é da PESSOA (user_id), não da empresa: cada um ativa no próprio celular.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { chavePublicaPush, endpointValido, pushConfigurado } from '@/lib/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let aparelhos: { endpoint: string; aparelho: string | null; criado_em: string; ultimo_ok_em: string | null }[] = []
  try {
    aparelhos = await query(
      `SELECT endpoint, aparelho, criado_em, ultimo_ok_em FROM push_inscricoes
        WHERE user_id = $1 AND vencida_em IS NULL ORDER BY criado_em`, [t.userId],
    )
  } catch { /* tabela ainda não criada (radar:migrate): lista vazia */ }
  return NextResponse.json({ configurado: pushConfigurado(), chave: chavePublicaPush(), aparelhos })
}

const b64url = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+=*$/.test(s)

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  if (!pushConfigurado()) return NextResponse.json({ error: 'aviso no celular ainda não ligado no servidor' }, { status: 503 })
  let body: { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; aparelho?: unknown; substitui?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'corpo inválido' }, { status: 400 }) }
  const s = body.subscription
  if (!s || !endpointValido(s.endpoint) || !b64url(s.keys?.p256dh, 200) || !b64url(s.keys?.auth, 100)) {
    return NextResponse.json({ error: 'inscrição inválida' }, { status: 400 })
  }
  const aparelho = typeof body.aparelho === 'string' ? body.aparelho.slice(0, 80) : null

  // RENOVAÇÃO (o navegador trocou a inscrição; ver public/sw.js e PushReconcilia): só vale
  // se o endpoint antigo ainda for desta pessoa, ou se o novo já estiver registrado (o
  // service worker chegou antes). Se a pessoa removeu o aparelho pela lista, 409: ele não
  // volta sozinho.
  if (typeof body.substitui === 'string') {
    const conhecidos = await query<{ endpoint: string }>(
      `SELECT endpoint FROM push_inscricoes WHERE user_id = $1 AND endpoint = ANY($2::text[])`,
      [t.userId, [body.substitui, s.endpoint]],
    )
    if (!conhecidos.length) return NextResponse.json({ error: 'aparelho removido' }, { status: 409 })
    if (body.substitui !== s.endpoint) {
      await query(`DELETE FROM push_inscricoes WHERE endpoint = $1 AND user_id = $2`, [body.substitui, t.userId])
    }
  }
  // O mesmo aparelho pode trocar de dono (outra pessoa entra no mesmo navegador): vale o último.
  await query(
    `INSERT INTO push_inscricoes (endpoint, user_id, titular_id, p256dh, auth, aparelho)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, titular_id = EXCLUDED.titular_id,
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, aparelho = EXCLUDED.aparelho, falhas = 0, vencida_em = NULL`,
    [s.endpoint, t.userId, t.titularId, s.keys!.p256dh, s.keys!.auth, aparelho],
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { endpoint?: unknown }
  try { body = await req.json() } catch { body = {} }
  if (typeof body.endpoint !== 'string') return NextResponse.json({ error: 'endpoint ausente' }, { status: 400 })
  await query(`DELETE FROM push_inscricoes WHERE endpoint = $1 AND user_id = $2`, [body.endpoint, t.userId])
  return NextResponse.json({ ok: true })
}
