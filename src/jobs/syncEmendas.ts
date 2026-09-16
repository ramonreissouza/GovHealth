// src/jobs/syncEmendas.ts — SINCRONIZAÇÃO das emendas de saúde (agendada via
// pg-boss, worker; ver src/worker/index.ts). A rota
// src/app/api/cron/sync-emendas/route.ts é hoje só uma casca fina para disparo
// manual/debug via HTTP — quem agenda de verdade é o worker.
//
// Alimenta o Radar de Verba. A rota /api/radar-verba lê do banco (instantâneo); este
// job é quem mantém o banco cheio, varrendo TODAS as páginas do Portal com o filtro
// de função no servidor (codigoFuncao=10). Sem isto, puxar ao vivo estourava o timeout
// de 30s + rate-limit — e o cap antigo de 8 páginas devolvia só um punhado de emendas.
//
// Cobre o ano corrente e o anterior (onde estão as emendas com verba ainda não paga).
// budgetMs por ano protege a duração total da rodada; se truncar por tempo, a próxima
// rodada completa (UPSERT idempotente por codigo_emenda).

import { ingestEmendasSaudeAno } from '@/lib/emendas-ingest'

export async function runSyncEmendas() {
  const inicio = Date.now()
  const anoAtual = new Date().getFullYear()
  const anos = [anoAtual, anoAtual - 1]

  // Orçamento de tempo dividido entre os anos, com folga p/ o encerramento.
  const budgetPorAno = 50_000
  const resumos = []
  for (const ano of anos) {
    resumos.push(await ingestEmendasSaudeAno(ano, { delayMs: 200, budgetMs: budgetPorAno }))
  }

  const totalGravadas = resumos.reduce((s, r) => s + r.gravadas, 0)
  const msg = `[cron:sync-emendas] ${resumos.map((r) => `${r.ano}:${r.gravadas}/${r.recebidas}`).join(' ')} `
    + `(${totalGravadas} gravadas) em ${Date.now() - inicio}ms`
  console.log(msg)

  return {
    ok: true as const,
    resumos,
    totalGravadas,
    duracaoMs: Date.now() - inicio,
    rodadoEm: new Date().toISOString(),
  }
}
