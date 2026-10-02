import { PgBoss, type QueuePolicy } from 'pg-boss'
import { runSyncPncp } from '@/jobs/syncPncp'
import { runSyncEmendas } from '@/jobs/syncEmendas'
import { runAlertasEmail } from '@/jobs/alertasEmail'
import { runTrialReminders } from '@/jobs/trialReminders'
import { runRadarNotify } from '@/jobs/radarNotify'
import { runRadarResumo } from '@/jobs/radarResumo'

const TZ = 'America/Sao_Paulo'

const JOBS: { name: string; cron: string; run: () => Promise<unknown>; policy?: QueuePolicy; silencioso?: boolean }[] = [
  { name: 'sync-pncp', cron: '0 3 * * *', run: runSyncPncp },
  { name: 'sync-emendas', cron: '0 4 * * *', run: runSyncEmendas },
  { name: 'alertas-email', cron: '0 11 * * *', run: runAlertasEmail },
  { name: 'trial-reminders', cron: '0 12 * * *', run: runTrialReminders },
  // A cada 5 min. `stately`: no máximo uma rodada ativa e uma na fila — uma rodada lenta
  // não empilha outras atrás dela, e duas nunca enviam a mesma linha ao mesmo tempo.
  { name: 'radar-notify', cron: '*/5 * * * *', run: runRadarNotify, policy: 'stately', silencioso: true },
  // O e-mail único do dia, antes do expediente.
  { name: 'radar-resumo', cron: '30 7 * * *', run: runRadarResumo, policy: 'stately' },
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
      // A rodada de 5 min loga só quando há o que contar (o próprio job decide).
      if (!job.silencioso) console.log(`[pg-boss] iniciando ${job.name}`)
      await job.run()
      if (!job.silencioso) console.log(`[pg-boss] concluído ${job.name}`)
    })
  }

  console.log(`[pg-boss] worker no ar — ${JOBS.length} jobs agendados (tz ${TZ})`)
}

main().catch((err) => {
  console.error('[pg-boss] worker falhou ao subir:', err)
  process.exit(1)
})
