// src/middleware.ts — roteamento de acesso.
// Objetivo (item 1 do TOP10 v2): o apex deixa de "abrir direto no login".
//  - Visitante NÃO logado no apex "/"  → landing pública "/inicio"
//  - Visitante NÃO logado em rota interna → "/login" (com callbackUrl)
//  - Usuário logado → dashboard normal; é redirecionado para "/" se cair em /login|/inicio
// Rotas públicas: /inicio, /login, /metodologia (+ assets e /api/auth).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const ROTAS_PUBLICAS = ['/inicio', '/login', '/metodologia']

function ehPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (token) {
    // Logado: mantém fora das páginas de entrada.
    if (pathname === '/login' || pathname === '/inicio') {
      return NextResponse.redirect(new URL('/', req.url))
    }
    return NextResponse.next()
  }

  // Não logado.
  if (ehPublica(pathname)) return NextResponse.next()
  if (pathname === '/') return NextResponse.redirect(new URL('/inicio', req.url))

  const url = new URL('/login', req.url)
  url.searchParams.set('callbackUrl', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}
