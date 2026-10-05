// src/app/api/assinaturas/status/route.ts — status da assinatura por session_id
// (usado pela página de sucesso p/ confirmar que o webhook ativou). Rota PÚBLICA.
//
// O session_id vem da URL, e URL vaza. Por isso (revisão da #63):
//  - sem o cookie HttpOnly criado no checkout, a resposta diz só o status;
//  - com o cookie, diz também o e-mail MASCARADO e o resultado das boas-vindas;
//  - nada aqui é armazenável: `Cache-Control: private, no-store` em toda resposta.
import { NextRequest, NextResponse } from 'next/server'
import { assinaturaPorSession } from '@/lib/assinaturas'
import { COOKIE_CHECKOUT, nonceConfere, mascararEmail } from '@/lib/checkout-cookie'
import { BOAS_VINDAS_LINK_HORAS } from '@/lib/seguranca'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SEM_CACHE = { 'Cache-Control': 'private, no-store' }

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return NextResponse.json({ error: 'session_id inválido' }, { status: 400, headers: SEM_CACHE })
  }
  const a = await assinaturaPorSession(sessionId)
  if (!a) return NextResponse.json({ status: 'desconhecida' }, { headers: SEM_CACHE })

  if (!nonceConfere(req.cookies.get(COOKIE_CHECKOUT)?.value, a.nonceHash)) {
    return NextResponse.json({ status: a.status }, { headers: SEM_CACHE })
  }
  return NextResponse.json({
    status: a.status, plano: a.plano, email: mascararEmail(a.email),
    contaNova: a.contaNova, emailEnviado: a.emailEnviado, validadeLinkHoras: BOAS_VINDAS_LINK_HORAS,
  }, { headers: SEM_CACHE })
}
