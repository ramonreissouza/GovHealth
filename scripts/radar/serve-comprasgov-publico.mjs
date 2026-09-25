import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
if (process.argv.includes('--assistido')) process.env.RADAR_PUBLICO_ASSISTIDO = '1'

// Espera após o término: nunca acumula passadas se o portal ficar lento.
// A trava no banco também protege contra um segundo serviço ou o coletor geral.
const intervalo = Number(process.env.RADAR_PUBLICO_INTERVAL_SECONDS || 300)
if (!Number.isInteger(intervalo) || intervalo < 300 || intervalo > 86400) {
  console.error('RADAR_PUBLICO_INTERVAL_SECONDS deve estar entre 300 e 86400.')
  process.exit(1)
}
let filho, timer, encerrando = false
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => {
  encerrando = true
  clearTimeout(timer)
  filho?.kill('SIGTERM')
})
function executar() {
  if (encerrando) return
  filho = spawn(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url)), '--comprasgov-publico'], { stdio: 'inherit', windowsHide: true })
  filho.on('error', () => console.error('Não foi possível iniciar o coletor público.'))
  filho.on('close', (codigo) => {
    filho = null
    if (codigo) console.error(`Coleta pública terminou com código ${codigo}; consulte a saúde do Radar.`)
    if (!encerrando) timer = setTimeout(executar, intervalo * 1000)
  })
}
executar()
