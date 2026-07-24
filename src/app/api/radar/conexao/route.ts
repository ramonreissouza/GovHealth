// src/app/api/radar/conexao/route.ts — proxy do Next para o browser-service (host).
// A tela chama aqui (mesma origem, autenticada); nós validamos o tenant e
// encaminhamos com o token interno. Assim o token nunca vai ao cliente e o
// browser-service só é acessível via app.
// POST { credencialId, acao: 'iniciar' | 'capturar' | 'cancelar' }

import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'
export const maxDuration = 60

const ROTA: Record<string, string> = { iniciar: '/session', capturar: '/capture', cancelar: '/cancel' }

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { credencialId?: string; acao?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const path = ROTA[body.acao ?? '']
  if (!path || !body.credencialId) return NextResponse.json({ error: 'acao/credencialId inválidos' }, { status: 400 })

  // A credencial precisa ser do próprio tenant (isolamento).
  const cred = await queryOne<{ id: string }>(
    `SELECT id FROM radar_credenciais WHERE id = $1 AND titular_id = $2`, [body.credencialId, t.titularId],
  )
  if (!cred) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })

  const base = process.env.RADAR_CONNECT_URL
  const token = process.env.RADAR_CONNECT_TOKEN
  if (!base || !token) {
    return NextResponse.json(
      { error: 'hosted_indisponivel', instrucoes: 'Configure RADAR_CONNECT_URL/RADAR_CONNECT_TOKEN e rode o browser-service (docker compose -f docker-compose.radar.yml up -d + npm run radar:browser-service).' },
      { status: 503 },
    )
  }

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-radar-token': token },
      body: JSON.stringify({ credencialId: body.credencialId }),
    })
    const j = await r.json().catch(() => ({}))
    return NextResponse.json(j, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'browser_service_indisponivel', detalhe: String(e) }, { status: 502 })
  }
}
