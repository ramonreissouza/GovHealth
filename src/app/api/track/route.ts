// src/app/api/track/route.ts — registra page_view do usuário LOGADO (para o
// dashboard do admin saber o que é mais acessado). A identidade vem da sessão
// (não confia no cliente); geo vem dos headers. Best-effort, nunca bloqueia.
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { registrarAcesso, extrairGeo } from '@/lib/acessos'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { rota } = await req.json().catch(() => ({}))
    if (typeof rota !== 'string' || !rota.startsWith('/') || rota.length > 200) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ ok: false }) // só rastreia logados

    const u = session.user as { id?: string; name?: string | null; email?: string | null }
    const geo = extrairGeo((n) => req.headers.get(n))
    await registrarAcesso({
      userId: u.id ?? u.email ?? null, nome: u.name ?? null, email: u.email ?? null,
      evento: 'page_view', rota, geo,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.warn('[track]', e)
    return NextResponse.json({ ok: false })
  }
}
