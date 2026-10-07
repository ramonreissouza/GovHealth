// src/app/api/erro-cliente/route.ts — recebe os erros do navegador e os põe no SigNoz
// como os do servidor (TS-540). O SDK de Node não enxerga um componente quebrando na
// tela do cliente; quem manda é src/lib/erro-cliente.ts.
//
// Pública (liberada no middleware), porque a landing e o login também quebram. O
// rate limit de API do middleware (150/min por IP) vale aqui. A validação e o que
// pode ir para a telemetria (redação, e nada de stack sem sessão) estão em
// src/lib/erro-cliente-servidor.ts.
//
// A stack chega minificada: os source maps de produção não são publicados. O que dá
// para ler é a mensagem, a rota e o `digest`, que liga ao erro do servidor.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { lerErroCliente, prepararErroCliente } from '@/lib/erro-cliente-servidor'
import { registrarErro } from '@/lib/rastreio'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const recebido = lerErroCliente(await req.text().catch(() => ''))
  if (!recebido) return new NextResponse(null, { status: 400 })

  const sessao = await getServerSession(authOptions).catch(() => null)
  const { excecao, atributos } = prepararErroCliente(recebido, !!sessao?.user)
  registrarErro('erro no navegador', excecao, {
    ...atributos,
    'user_agent.original': req.headers.get('user-agent')?.slice(0, 300) ?? '',
  })
  return new NextResponse(null, { status: 204 })
}
