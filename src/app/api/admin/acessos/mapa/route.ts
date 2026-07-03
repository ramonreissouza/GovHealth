// src/app/api/admin/acessos/mapa/route.ts — pontos lat/lng agregados p/ o mapa. Só master.
import { NextRequest, NextResponse } from 'next/server'
import { exigirMaster } from '@/lib/admin-guard'
import { pontosMapa } from '@/lib/acessos'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  const { searchParams } = req.nextUrl
  try {
    const pontos = await pontosMapa({
      dias: searchParams.get('dias') ? Number(searchParams.get('dias')) : undefined,
      userId: searchParams.get('userId') ?? undefined,
    })
    return NextResponse.json({ pontos })
  } catch (e) {
    console.error('[admin/acessos/mapa]', e)
    return NextResponse.json({ error: 'Erro ao consultar mapa' }, { status: 500 })
  }
}
