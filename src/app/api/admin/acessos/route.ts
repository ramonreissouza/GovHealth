// src/app/api/admin/acessos/route.ts — log de acessos paginado/filtrado. Só master.
import { NextRequest, NextResponse } from 'next/server'
import { exigirMaster } from '@/lib/admin-guard'
import { listarAcessos } from '@/lib/acessos'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  const { searchParams } = req.nextUrl
  try {
    const dados = await listarAcessos({
      busca: searchParams.get('busca') ?? undefined,
      evento: searchParams.get('evento') ?? undefined,
      dias: searchParams.get('dias') ? Number(searchParams.get('dias')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 50,
      offset: searchParams.get('offset') ? Number(searchParams.get('offset')) : 0,
    })
    return NextResponse.json(dados)
  } catch (e) {
    console.error('[admin/acessos]', e)
    return NextResponse.json({ error: 'Erro ao consultar acessos' }, { status: 500 })
  }
}
