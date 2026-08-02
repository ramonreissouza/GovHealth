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
import { ehRotaPro, ehRotaEmpresa, temAcessoPro, temAcessoEmpresa } from '@/lib/plano-gating'

const ROTAS_PUBLICAS = ['/inicio', '/login', '/metodologia', '/privacidade', '/assinar', '/aceitar-convite', '/esqueci-senha', '/redefinir-senha']

function ehPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Trial expirado quando a data de expiração (YYYY-MM-DD) é anterior a hoje (UTC). */
function trialExpirado(expiraEm: string): boolean {
  const hoje = new Date().toISOString().slice(0, 10)
  return expiraEm.slice(0, 10) < hoje
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

  // ── Arquivos estáticos públicos (logo, screenshots, fontes, etc.) ────────────
  // Devem ser acessíveis SEM auth — inclusive por crawlers sociais (OG) e clientes
  // de e-mail (logo). Sem isso, o middleware os redireciona para /login.
  if (/\.(png|jpe?g|svg|gif|webp|avif|ico|bmp|woff2?|ttf|otf|txt|xml|json|map|css|js)$/i.test(pathname)) {
    return NextResponse.next()
  }

  // ── Rate limiting (best-effort por instância) para rotas de API ──────────────
  if (pathname.startsWith('/api/')) {
    const ip = ipDe(req)
    if (pathname === '/api/auth/callback/credentials' || pathname === '/api/auth/otp' || pathname === '/api/senha/solicitar') {
      const r = await rateLimit(`login:${ip}`, 10, 60_000) // brute force de login/OTP/reset: 10/min
      if (!r.ok) return resp429(r)
    } else if (!pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/cron/') && !pathname.startsWith('/api/stripe/')) {
      // /api/stripe/webhook: o Stripe pode enviar rajadas de eventos — não limitar
      // (é autenticado pela assinatura HMAC do payload na própria rota).
      const r = await rateLimit(`api:${ip}`, 150, 60_000) // APIs de dados: 150/min
      if (!r.ok) return resp429(r)
    }
  }

  // ── NextAuth, cron e Stripe não passam pela auth de sessão do middleware ──────
  // NextAuth gerencia o próprio fluxo; o cron é protegido pelo CRON_SECRET; o
  // webhook do Stripe é validado pela assinatura HMAC na própria rota.
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/cron/') || pathname.startsWith('/api/stripe/') || pathname.startsWith('/api/assinaturas') || pathname.startsWith('/api/cadastro') || pathname.startsWith('/api/senha') || pathname.startsWith('/api/equipe/aceitar')) {
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
    const t = token as { status?: string | null; expiraEm?: string | null; plano?: string | null; role?: string | null }
    const trialBloqueado = t.status === 'trial' && typeof t.expiraEm === 'string' && trialExpirado(t.expiraEm)

    // Logado não deve ficar no login/landing → vai pro dashboard. EXCEÇÃO: trial
    // EXPIRADO precisa poder ver a landing pública /inicio — senão fica preso no
    // /assinar (toda rota interna o manda de volta pra lá, sem "página principal"
    // acessível). Assim o botão "Voltar" do /assinar tem para onde ir.
    if (pathname === '/login' || pathname === '/inicio') {
      if (trialBloqueado && pathname === '/inicio') return NextResponse.next()
      return NextResponse.redirect(new URL('/', req.url))
    }
    // Gate de teste grátis: trial expirado → pede pagamento (só páginas internas;
    // não afeta APIs nem rotas públicas como /assinar, /metodologia).
    if (
      trialBloqueado &&
      !pathname.startsWith('/api/') && !ehPublica(pathname)
    ) {
      const url = new URL('/assinar', req.url)
      url.searchParams.set('trial', 'expirado')
      url.searchParams.set('plano', t.plano || 'pro')
      return NextResponse.redirect(url)
    }
    // Gate por plano. Empresa (Radar de Chat, Equipe) tem prioridade sobre Pro.
    if (!pathname.startsWith('/api/') && !ehPublica(pathname)) {
      const ctx = { plano: t.plano, role: t.role, status: t.status }
      const bloqueio = ehRotaEmpresa(pathname) && !temAcessoEmpresa(ctx)
        ? 'empresa'
        : ehRotaPro(pathname) && !temAcessoPro(ctx)
        ? 'pro'
        : null
      if (bloqueio) {
        const url = new URL('/assinar', req.url)
        url.searchParams.set('upgrade', bloqueio)
        url.searchParams.set('recurso', pathname)
        return NextResponse.redirect(url)
      }
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
