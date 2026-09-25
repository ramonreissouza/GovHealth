import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Serviço dedicado: uma passada de cada vez, sem competir com crawlers lentos.
// As datas proxima_consulta no banco controlam a frequência de cada canal.
if (process.env.RADAR_COMPRASGOV_ENABLED !== '1' || !process.env.SERPRO_CONSUMER_KEY || !process.env.SERPRO_CONSUMER_SECRET) {
  console.error('Configure e ative o Integra Compras antes de iniciar o serviço.')
  process.exit(1)
}
let filho = null
let timer = null
let encerrando = false
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => {
  encerrando = true
  clearTimeout(timer)
  filho?.kill('SIGTERM')
})
function executar() {
  if (encerrando) return
  filho = spawn(process.execPath, [fileURLToPath(new URL('./run-comprasgov-api.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true })
  filho.on('error', () => console.error('Não foi possível iniciar o coletor Integra Compras.'))
  filho.on('close', () => {
    filho = null
    if (!encerrando) timer = setTimeout(executar, 60_000)
  })
}
executar()
