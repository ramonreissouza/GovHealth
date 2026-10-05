// src/app/api/admin/aviso/route.ts — quanto tempo o Aviso do Radar leva, etapa por etapa
// (src/lib/radar/latencia-aviso.ts), para a aba Aviso do admin. ?dias= (1–90). Só master.
import { NextRequest, NextResponse } from 'next/server'
import { exigirMaster } from '@/lib/admin-guard'
import { painelAviso } from '@/lib/radar/latencia-aviso'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  try {
    return NextResponse.json(await painelAviso(Number(req.nextUrl.searchParams.get('dias')) || 7))
  } catch (e) {
    console.error('[admin/aviso]', e)
    return NextResponse.json({ error: 'Erro ao medir o Aviso' }, { status: 500 })
  }
}
