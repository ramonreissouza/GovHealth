import { reivindicarLembretesTrial, reivindicarExpiradosTrial } from '@/lib/users'
import { enviarLembreteTrial, enviarTesteExpirado } from '@/lib/email'

export async function runTrialReminders() {
  // 1) Lembrete: trials que expiram AMANHÃ.
  const alvos = await reivindicarLembretesTrial()
  let enviados = 0
  for (const u of alvos) {
    const r = await enviarLembreteTrial({ email: u.email, nome: u.nome, plano: u.plano ?? 'pro', expiraEm: u.expira_em })
    if (r.enviado) enviados++
    else console.warn(`[cron/trial-reminders] lembrete não enviado p/ ${u.email}: ${r.motivo}`)
  }
  // 2) "Teste acabou": trials que EXPIRARAM (últimos 3 dias) — assine para voltar.
  const expirados = await reivindicarExpiradosTrial()
  let enviadosExp = 0
  for (const u of expirados) {
    const r = await enviarTesteExpirado({ email: u.email, nome: u.nome, plano: u.plano ?? 'pro' })
    if (r.enviado) enviadosExp++
    else console.warn(`[cron/trial-reminders] expirado não enviado p/ ${u.email}: ${r.motivo}`)
  }
  return {
    ok: true as const,
    lembretes: { candidatos: alvos.length, enviados },
    expirados: { candidatos: expirados.length, enviados: enviadosExp },
  }
}
