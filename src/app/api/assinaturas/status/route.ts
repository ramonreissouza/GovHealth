// src/app/api/assinaturas/status/route.ts — status da assinatura por session_id
// (usado pela página de sucesso p/ confirmar que o webhook ativou). Rota PÚBLICA.
import { NextRequest, NextResponse } from 'next/server'
import { assinaturaPorSession } from '@/lib/assinaturas'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return NextResponse.json({ error: 'session_id inválido' }, { status: 400 })
  }
  const a = await assinaturaPorSession(sessionId)
  if (!a) return NextResponse.json({ status: 'desconhecida' })
  return NextResponse.json({ status: a.status, plano: a.plano, email: a.email })
}
