// src/app/api/admin/dashboard/route.ts — KPIs gerenciais (dados reais). Só master.
import { NextRequest, NextResponse } from 'next/server'
import { exigirMaster } from '@/lib/admin-guard'
import { kpisAdmin } from '@/lib/users'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  try {
    return NextResponse.json(await kpisAdmin())
  } catch (e) {
    console.error('[admin/dashboard]', e)
    return NextResponse.json({ error: 'Erro ao carregar KPIs' }, { status: 500 })
  }
}
