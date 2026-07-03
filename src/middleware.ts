// src/middleware.ts — roteamento de acesso + rate limiting.
// Roteamento (item 1 do TOP10 v2):
//  - Visitante NÃO logado no apex "/"  → landing pública "/inicio"
//  - Visitante NÃO logado em rota interna → "/login" (com callbackUrl)
//  - Usuário logado → dashboard; é redirecionado para "/" se cair em /login|/inicio
// Rotas públicas: /inicio, /login, /metodologia (+ assets, /api/auth, /api/cron).
//
// Segurança (checklist):
//  - Item 11: /api/cron NÃO passa pela auth de sessão (era bloqueado antes de checar
//    o CRON_SECRET). Agora passa direto; a própria rota valida o Bearer CRON_SECRET.
//  - Itens 6 e 9: rate limiting — login estrito (brute force) e APIs de dados (abuso).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { rateLimit, type RateResult } from '@/lib/rate-limit'
import { tokenMaster } from '@/lib/admin-guard'

const ROTAS_PUBLICAS = ['/inicio', '/login', '/metodologia', '/assinar']

function ehPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function ipDe(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  return (xff ? xff.split(',')[0].trim() : '') || req.headers.get('x-real-ip') || 'desconhecido'
}

function resp429(r: RateResult): NextResponse {
  return new NextResponse(JSON.stringify({ error: 'Muitas requisições — tente de novo em instantes.' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'Retry-After': String(r.retryAfter) },
  })
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Rate limiting (best-effort por instância) para rotas de API ──────────────
  if (pathname.startsWith('/api/')) {
    const ip = ipDe(req)
    if (pathname === '/api/auth/callback/credentials') {
      const r = rateLimit(`login:${ip}`, 10, 60_000) // brute force de login: 10/min
      if (!r.ok) return resp429(r)
    } else if (!pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/cron/')) {
      const r = rateLimit(`api:${ip}`, 150, 60_000) // APIs de dados: 150/min
      if (!r.ok) return resp429(r)
    }
  }

  // ── NextAuth e cron não passam pela auth de sessão do middleware ─────────────
  // NextAuth gerencia o próprio fluxo; o cron é protegido pelo CRON_SECRET na rota.
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/cron/') || pathname.startsWith('/api/assinaturas')) {
    return NextResponse.next()
  }

  // ── Área ADMIN: exige role master (checagem server-side; item mais sensível) ──
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin')) {
    const master = await tokenMaster(req)
    if (!master) {
      if (pathname.startsWith('/api/admin')) {
        return NextResponse.json({ error: 'Acesso restrito ao administrador.' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/', req.url)) // esconde a existência da área
    }
    return NextResponse.next()
  }

  // ── Auth de sessão (páginas e demais APIs) ───────────────────────────────────
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (token) {
    if (pathname === '/login' || pathname === '/inicio') {
      return NextResponse.redirect(new URL('/', req.url))
    }
    return NextResponse.next()
  }

  if (ehPublica(pathname)) return NextResponse.next()
  if (pathname === '/') return NextResponse.redirect(new URL('/inicio', req.url))

  const url = new URL('/login', req.url)
  url.searchParams.set('callbackUrl', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    // Roda em tudo (inclui /api/auth e /api/cron para o rate limit poder atuar);
    // cada um é tratado/liberado dentro da função. Exclui só assets estáticos.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
