// src/app/api/admin/analytics/route.ts — análise de acessos (quem acessa / o que
// é mais acessado) para o dashboard do admin. Filtros: ?dias= e ?uf=. Só master.
import { NextRequest, NextResponse } from 'next/server'
import { exigirMaster } from '@/lib/admin-guard'
import { analiseAcessos } from '@/lib/acessos'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  try {
    const sp = req.nextUrl.searchParams
    const dias = Number(sp.get('dias')) || 30
    const uf = sp.get('uf') ?? undefined
    return NextResponse.json(await analiseAcessos({ dias, uf }))
  } catch (e) {
    console.error('[admin/analytics]', e)
    return NextResponse.json({ error: 'Erro ao carregar análise' }, { status: 500 })
  }
}
