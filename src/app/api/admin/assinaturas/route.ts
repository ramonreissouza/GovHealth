// src/app/api/admin/assinaturas/route.ts — lista as intenções de assinatura
// (pendências do checkout público). Só master.
import { NextRequest, NextResponse } from 'next/server'
import { exigirMaster } from '@/lib/admin-guard'
import { listarAssinaturas } from '@/lib/assinaturas'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  try {
    return NextResponse.json({ assinaturas: await listarAssinaturas(200) })
  } catch (e) {
    console.error('[admin/assinaturas]', e)
    return NextResponse.json({ error: 'Erro ao listar assinaturas' }, { status: 500 })
  }
}
