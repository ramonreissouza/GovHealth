// src/app/api/radar/config/route.ts — preferências de notificação do Monitorar Chat.
// GET: config atual (com defaults) + palavras-chave monitoradas + sugestões do sistema.
// PUT: grava a config. As palavras-chave são criadas/removidas por /api/radar/regras.
//
// Guardado em user_data (chave 'radar_config') no titular — a configuração é da
// EMPRESA, não de quem abriu a tela, para o time todo receber o mesmo alerta.

import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { CHAVE_CONFIG, CHAVES_SUGERIDAS, sanearConfig } from '@/lib/radar/config'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const row = await queryOne<{ valor: unknown }>(
    `SELECT valor FROM user_data WHERE user_id = $1 AND chave = $2`, [t.titularId, CHAVE_CONFIG],
  )
  const chaves = await query<{ id: string; padrao: string; prioridade: string }>(
    `SELECT id, padrao, prioridade FROM radar_regras
      WHERE titular_id = $1 AND tipo = 'keyword' AND ativo = true AND padrao IS NOT NULL
      ORDER BY criado_em`,
    [t.titularId],
  )

  const jaTem = new Set(chaves.map((c) => c.padrao.toLowerCase()))
  return NextResponse.json({
    config: sanearConfig(row?.valor),
    chaves,
    sugeridas: CHAVES_SUGERIDAS.filter((s) => !jaTem.has(s.toLowerCase())),
  })
}

export async function PUT(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }

  const config = sanearConfig(body)
  await query(
    `INSERT INTO user_data (user_id, chave, valor, atualizado_em)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id, chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
    [t.titularId, CHAVE_CONFIG, JSON.stringify(config)],
  )
  return NextResponse.json({ ok: true, config })
}
