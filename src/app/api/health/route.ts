// src/app/api/health/route.ts — o que o monitor de disponibilidade externo consulta
// (TS-540; ver docs/monitoramento.md).
//
// Diferente da `/inicio`, que é a probe do k8s: aquela página responde mesmo com o
// banco fora, e o cliente logado não consegue fazer nada. Aqui o 200 só sai se o
// Postgres respondeu. Pública e sem sessão (liberada no middleware), por isso não
// devolve nada além de ok/fora: nem versão, nem mensagem de erro.
//
// O `select 1` usa um pool só dele, de uma conexão, com teto de 1,5 s em cada etapa
// (`pingBanco`, em src/lib/db.ts). Com o banco travado, a resposta é um 503 em no
// máximo ~3 s, e nenhuma consulta fica presa ocupando conexão do app.
//
// Não serve de probe do k8s. Com o banco fora, tirar o app do Service troca a tela
// de erro por um 502 do Traefik e não conserta nada.

import { NextResponse } from 'next/server'
import { pingBanco } from '@/lib/db'
import { registrarErro } from '@/lib/rastreio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const inicio = Date.now()
  try {
    await pingBanco()
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
  }
}
