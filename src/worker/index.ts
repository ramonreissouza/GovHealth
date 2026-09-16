import { PgBoss } from 'pg-boss'
import { runSyncPncp } from '@/jobs/syncPncp'
import { runSyncEmendas } from '@/jobs/syncEmendas'
import { runAlertasEmail } from '@/jobs/alertasEmail'
import { runTrialReminders } from '@/jobs/trialReminders'

const TZ = 'America/Sao_Paulo'

const JOBS: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: 'sync-pncp', cron: '0 3 * * *', run: runSyncPncp },
  { name: 'sync-emendas', cron: '0 4 * * *', run: runSyncEmendas },
  { name: 'alertas-email', cron: '0 11 * * *', run: runAlertasEmail },
  { name: 'trial-reminders', cron: '0 12 * * *', run: runTrialReminders },
]

async function main() {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: 'pgboss',
  })

  boss.on('error', (err) => console.error('[pg-boss]', err))
  await boss.start()

  for (const job of JOBS) {
    await boss.createQueue(job.name)
    await boss.schedule(job.name, job.cron, {}, { tz: TZ })
  }

  for (const job of JOBS) {
    await boss.work(job.name, async () => {
      console.log(`[pg-boss] iniciando ${job.name}`)
      await job.run()
      console.log(`[pg-boss] concluído ${job.name}`)
    })
  }

  console.log(`[pg-boss] worker no ar — ${JOBS.length} jobs agendados (tz ${TZ})`)
}

main().catch((err) => {
  console.error('[pg-boss] worker falhou ao subir:', err)
  process.exit(1)
})
