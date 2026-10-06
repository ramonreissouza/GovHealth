import { PgBoss, type QueuePolicy } from 'pg-boss'
import { runSyncPncp } from '@/jobs/syncPncp'
import { runSyncEmendas } from '@/jobs/syncEmendas'
import { runAlertasEmail } from '@/jobs/alertasEmail'
import { runTrialReminders } from '@/jobs/trialReminders'
import { runRadarNotify } from '@/jobs/radarNotify'
import { runRadarResumo } from '@/jobs/radarResumo'
import { comSpan } from '@/lib/rastreio'

const TZ = 'America/Sao_Paulo'

const JOBS: { name: string; cron: string; run: () => Promise<unknown>; policy?: QueuePolicy; silencioso?: boolean }[] = [
  { name: 'sync-pncp', cron: '0 3 * * *', run: runSyncPncp },
  { name: 'sync-emendas', cron: '0 4 * * *', run: runSyncEmendas },
  { name: 'alertas-email', cron: '0 11 * * *', run: runAlertasEmail },
  { name: 'trial-reminders', cron: '0 12 * * *', run: runTrialReminders },
  // A cada 5 min. `stately`: no máximo uma rodada ativa e uma na fila — uma rodada lenta
  // não empilha outras atrás dela, e duas nunca enviam a mesma linha ao mesmo tempo.
  { name: 'radar-notify', cron: '*/5 * * * *', run: runRadarNotify, policy: 'stately', silencioso: true },
  // O e-mail único do dia: às 07:30 para todos; nas horas seguintes, só para quem ainda
  // não recebeu hoje (nova chance para quem falhou). Ver src/jobs/radarResumo.ts.
  { name: 'radar-resumo', cron: '30 7-20 * * *', run: runRadarResumo, policy: 'stately', silencioso: true },
]

async function main() {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: 'pgboss',
  })

  boss.on('error', (err) => console.error('[pg-boss]', err))
  await boss.start()

  for (const job of JOBS) {
    await boss.createQueue(job.name, job.policy ? { policy: job.policy } : undefined)
    await boss.schedule(job.name, job.cron, {}, { tz: TZ })
  }

  for (const job of JOBS) {
    await boss.work(job.name, async () => {
      // Os jobs frequentes logam só quando há o que contar (o próprio job decide).
      if (!job.silencioso) console.log(`[pg-boss] iniciando ${job.name}`)
      try {
        // Um span por rodada: as queries e os fetch do job ficam pendurados nele, e
        // uma falha aparece no SigNoz (TS-540), não só neste log.
        await comSpan(`job ${job.name}`, job.run, { 'job.nome': job.name })
      } catch (err) {
        // O pg-boss marca o job como falho sem imprimir nada. Sem esta linha, um job
        // silencioso que quebra toda rodada não deixa rastro no log do worker.
        console.error(`[pg-boss] ${job.name} falhou:`, err)
        throw err
      }
      if (!job.silencioso) console.log(`[pg-boss] concluído ${job.name}`)
    })
  }

  console.log(`[pg-boss] worker no ar — ${JOBS.length} jobs agendados (tz ${TZ})`)
}

main().catch((err) => {
  console.error('[pg-boss] worker falhou ao subir:', err)
  process.exit(1)
})
