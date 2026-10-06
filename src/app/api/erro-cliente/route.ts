// src/app/api/erro-cliente/route.ts — recebe os erros do navegador e os põe no SigNoz
// como os do servidor (TS-540). O SDK de Node não enxerga um componente quebrando na
// tela do cliente; quem manda é src/lib/erro-cliente.ts.
//
// Pública (liberada no middleware), porque a landing e o login também quebram, e
// sem sessão. O rate limit de API do middleware (150/min por IP) vale aqui, e cada
// campo é cortado: quem chama é o navegador, e qualquer um pode chamar.
//
// A stack chega minificada: os source maps de produção não são publicados. O que dá
// para ler é a mensagem, a rota e o `digest`, que liga ao erro do servidor.

import { NextRequest, NextResponse } from 'next/server'
import { registrarErro } from '@/lib/rastreio'

export const runtime = 'nodejs'

const TIPOS = new Set(['render', 'global', 'janela', 'promessa'])

function texto(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v ? v.slice(0, max) : undefined
}

export async function POST(req: NextRequest) {
  const corpo = await req.text().catch(() => '')
  if (!corpo || corpo.length > 16_000) return new NextResponse(null, { status: 400 })

  let dados: Record<string, unknown>
  try { dados = JSON.parse(corpo) } catch { return new NextResponse(null, { status: 400 }) }

  const mensagem = texto(dados.mensagem, 500)
  const tipo = texto(dados.tipo, 20)
  if (!mensagem || !tipo || !TIPOS.has(tipo)) return new NextResponse(null, { status: 400 })

  const digest = texto(dados.digest, 100)
  registrarErro('erro no navegador', { name: texto(dados.nome, 100) ?? 'Error', message: mensagem, stack: texto(dados.stack, 4000) }, {
    'erro.tipo': tipo,
    // Só o caminho: a query string pode trazer o que o usuário digitou na busca.
    'url.path': texto(dados.rota, 200)?.split('?')[0] ?? '',
    'user_agent.original': req.headers.get('user-agent')?.slice(0, 300) ?? '',
    ...(digest ? { 'erro.digest': digest } : {}),
  })
  return new NextResponse(null, { status: 204 })
}
