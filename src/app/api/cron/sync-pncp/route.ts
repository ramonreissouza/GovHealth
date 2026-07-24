// src/app/api/cron/sync-pncp/route.ts — SINCRONIZAÇÃO DIÁRIA (Vercel Cron, 3h).
//
// Objetivo: manter a base 100% representativa do que está acontecendo AGORA, sem
// depender de máquina local. Antes esta rota só CONTAVA (buscava e descartava) — a
// base só era atualizada pelo ETL local a cada dias. Agora ela GRAVA:
//
//   1) ABERTAS (prioridade): /contratacoes/proposta — licitações recebendo proposta
//      neste momento. São as oportunidades vivas que o usuário não pode perder.
//   2) PUBLICAÇÕES RECENTES (últimas 48h): /contratacoes/publicacao — pega o que
//      entrou nos últimos dias (abertas e as que já nascem/foram encerradas),
//      cobrindo folga p/ publicações atrasadas do PNCP.
//
// Só grava o CABEÇALHO (a oportunidade). O enriquecimento caro (itens + resultados
// homologados → status encerrada) continua no refresh periódico, que roda sem o
// limite de tempo de uma função serverless. Uma contratação nova sem resultado
// aparece naturalmente como "Em aberto" nas telas — exatamente o que se quer.

import { NextRequest, NextResponse } from 'next/server'
import { buscarComprasSaude, buscarLicitacoesAbertas, toPncpDate } from '@/lib/pncp'
import { upsertContratacoes } from '@/lib/pncp-ingest'

export const runtime = 'nodejs'
// Fetches de LISTAGEM apenas (sem chamadas por item). O /proposta do PNCP é lento nas
// modalidades grandes; damos folga (120s, plano Pro) e a busca de abertas se auto-limita
// por orçamento de tempo (budgetMs) para nunca estourar.
export const maxDuration = 120

export async function GET(req: NextRequest) {
  // Vercel Cron autentica via CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  try {
    // Janela de publicação: últimas 48h (folga p/ publicações atrasadas do PNCP).
    const doisDiasAtras = new Date()
    doisDiasAtras.setDate(doisDiasAtras.getDate() - 2)
    const dataInicial = toPncpDate(doisDiasAtras)

    // 1) ABERTAS (prioridade) + 2) publicações recentes — em paralelo.
    // Abertas com orçamento de tempo (45s) p/ não estourar a função mesmo com o PNCP lento.
    const [abertas, recentes] = await Promise.all([
      buscarLicitacoesAbertas({ maxPaginasPorModalidade: 10, budgetMs: 45_000 }),
      buscarComprasSaude({ dataInicial, maxPaginasPorModalidade: 5 }),
    ])

    const candidatas = [...abertas, ...recentes.data]
    const resumo = await upsertContratacoes(candidatas)

    const msg = `[cron:sync-pncp] abertas=${abertas.length} recentes=${recentes.data.length} `
      + `→ ${resumo.gravadas}/${resumo.recebidas} gravadas (${resumo.falhas} falhas) em ${Date.now() - inicio}ms`
    console.log(msg)

    return NextResponse.json({
      ok: true,
      abertas: abertas.length,
      recentes: recentes.data.length,
      recebidas: resumo.recebidas,
      gravadas: resumo.gravadas,
      falhas: resumo.falhas,
      duracaoMs: Date.now() - inicio,
      rodarEm: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[cron:sync-pncp]', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
