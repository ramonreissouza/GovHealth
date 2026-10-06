// src/app/api/health/route.ts — o que o monitor de disponibilidade externo consulta
// (TS-540; ver docs/monitoramento.md).
//
// Diferente da `/inicio`, que é a probe do k8s: aquela página responde mesmo com o
// banco fora, e o cliente logado não consegue fazer nada. Aqui o 200 só sai se o
// Postgres respondeu. Pública e sem sessão (liberada no middleware), por isso não
// devolve nada além de ok/fora: nem versão, nem mensagem de erro.
//
// Não serve de probe do k8s. Com o banco fora, tirar o app do Service troca a tela
// de erro por um 502 do Traefik e não conserta nada.

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { registrarErro } from '@/lib/rastreio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Menor que o timeout dos monitores (30 s no UptimeRobot), para a resposta ser um 503
// legível e não um timeout sem corpo.
const TETO_MS = 3000

export async function GET() {
  const inicio = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      query('select 1'),
      new Promise((_, rejeita) => { timer = setTimeout(() => rejeita(new Error(`banco sem resposta em ${TETO_MS} ms`)), TETO_MS) }),
    ])
    return NextResponse.json(
      { status: 'ok', banco: 'ok', ms: Date.now() - inicio },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    registrarErro('health: banco fora', e)
    return NextResponse.json(
      { status: 'erro', banco: 'fora' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timer)
  }
}
