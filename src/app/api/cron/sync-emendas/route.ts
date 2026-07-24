// src/app/api/cron/sync-emendas/route.ts — SINCRONIZAÇÃO das emendas de saúde (Vercel Cron).
//
// Alimenta o Radar de Verba. A rota /api/radar-verba lê do banco (instantâneo); este
// cron é quem mantém o banco cheio, varrendo TODAS as páginas do Portal com o filtro
// de função no servidor (codigoFuncao=10). Sem isto, puxar ao vivo estourava o timeout
// de 30s + rate-limit — e o cap antigo de 8 páginas devolvia só um punhado de emendas.
//
// Cobre o ano corrente e o anterior (onde estão as emendas com verba ainda não paga).
// budgetMs por ano protege o limite de 120s da função; se truncar por tempo, a próxima
// rodada completa (UPSERT idempotente por codigo_emenda).

import { NextRequest, NextResponse } from 'next/server'
import { ingestEmendasSaudeAno } from '@/lib/emendas-ingest'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  try {
    const anoAtual = new Date().getFullYear()
    const anos = [anoAtual, anoAtual - 1]

    // Orçamento de tempo dividido entre os anos, com folga p/ o encerramento (<120s).
    const budgetPorAno = 50_000
    const resumos = []
    for (const ano of anos) {
      resumos.push(await ingestEmendasSaudeAno(ano, { delayMs: 200, budgetMs: budgetPorAno }))
    }

    const totalGravadas = resumos.reduce((s, r) => s + r.gravadas, 0)
    const msg = `[cron:sync-emendas] ${resumos.map((r) => `${r.ano}:${r.gravadas}/${r.recebidas}`).join(' ')} `
      + `(${totalGravadas} gravadas) em ${Date.now() - inicio}ms`
    console.log(msg)

    return NextResponse.json({
      ok: true,
      resumos,
      totalGravadas,
      duracaoMs: Date.now() - inicio,
      rodadoEm: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron:sync-emendas]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
