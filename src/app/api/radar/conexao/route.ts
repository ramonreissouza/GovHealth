// src/app/api/radar/conexao/route.ts — proxy do Next para o browser-service (host).
// A tela chama aqui (mesma origem, autenticada); nós validamos o tenant e
// encaminhamos com o token interno. Assim o token nunca vai ao cliente e o
// browser-service só é acessível via app.
// POST { credencialId, acao: 'iniciar' | 'capturar' | 'cancelar' }

import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'

export const runtime = 'nodejs'
export const maxDuration = 60

const ROTA: Record<string, string> = { iniciar: '/session', capturar: '/capture', cancelar: '/cancel' }

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { credencialId?: string; acao?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const path = ROTA[body.acao ?? '']
  if (!path || !body.credencialId) return NextResponse.json({ error: 'acao/credencialId inválidos' }, { status: 400 })

  // A credencial precisa ser do próprio tenant (isolamento).
  const cred = await queryOne<{ id: string }>(
    `SELECT id FROM radar_credenciais WHERE id = $1 AND titular_id = $2`, [body.credencialId, t.titularId],
  )
  if (!cred) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })

  const base = process.env.RADAR_CONNECT_URL
  const token = process.env.RADAR_CONNECT_TOKEN
  if (!base || !token) {
    return NextResponse.json(
      { error: 'hosted_indisponivel', instrucoes: 'Configure RADAR_CONNECT_URL/RADAR_CONNECT_TOKEN e rode o browser-service (docker compose -f docker-compose.radar.yml up -d + npm run radar:browser-service).' },
      { status: 503 },
    )
  }

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-radar-token': token },
      body: JSON.stringify({ credencialId: body.credencialId }),
    })
    // LER COMO TEXTO PRIMEIRO, e tratar "não é JSON" como a falha que é.
    //
    // Era `await r.json().catch(() => ({}))`. Quando o túnel cai, quem responde neste
    // endereço não é o browser-service: é a PÁGINA DE ERRO DA CLOUDFLARE, em HTML.
    // O `catch` engolia isso e devolvia `{}` — corpo vazio, sem `error`, sem `detalhe`
    // — e a tela, sem nada para mostrar, caía na frase genérica "Falha ao abrir o
    // gov.br". Foi o que o fornecedor viu em 14/09/2026: a única falha que o sistema
    // inteiro NÃO sabia nomear era justamente a mais provável.
    const txt = await r.text()
    let j: Record<string, unknown>
    try {
      j = txt ? JSON.parse(txt) : {}
    } catch {
      return NextResponse.json(
        { error: 'browser_service_indisponivel',
          detalhe: 'O navegador que abre o gov.br não respondeu (a ponte com a nossa máquina está fora do ar). Não é a sua conta nem a sua senha — já estamos avisados.' },
        { status: 502 },
      )
    }

    // TRADUZ `erro` -> `error` ANTES DE DEVOLVER.
    //
    // O browser-service fala `erro` (a casa e em portugues) e a tela le `error`. Sem
    // esta linha, TODA falha que o servico sabia nomear chegava na tela como a mesma
    // frase generica de reserva — "Falha ao abrir o gov.br" — mesmo quando a causa
    // real estava escrita no corpo da resposta. O fornecedor via uma parede lisa: nada
    // a fazer, nada a reportar, e a suspeita natural recaindo sobre a senha dele.
    // Foi exatamente o que aconteceu em 14/09/2026, com o container do navegador fora
    // do ar: o servico respondeu "falha ao criar a sessao", e ninguem leu.
    if (j && typeof j === 'object' && !Array.isArray(j) && j.erro !== undefined && j.error === undefined) {
      j.error = j.erro
    }

    return NextResponse.json(j, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: 'browser_service_indisponivel', detalhe: String(e) }, { status: 502 })
  }
}
