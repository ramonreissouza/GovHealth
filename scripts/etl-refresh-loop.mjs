// scripts/etl-refresh-loop.mjs — roda o etl-refresh.mjs QUANTAS PASSADAS FOREM
// NECESSÁRIAS até a janela fechar, e avisa quem mais quer o PNCP que ele está ocupado.
//
// POR QUE ISSO EXISTE. O etl-refresh.mjs tem orçamento de 330min (5h30) e, quando
// ele estoura, encerra PARCIAL. Medido em 22/08/2026, uma varredura completa de 21
// dias × 27 UFs custou 740min de trabalho real: a 1ª passada fechou 6 UFs (SP RJ MG
// RS PR BA), a 2ª fechou 11 (SC GO PE CE DF ES PA MT MS AM MA) e a 3ª fechou as 10
// menores em 80min. Ou seja: uma passada só NUNCA chega ao fim, e as UFs que sobram
// são justamente as pequenas — as que ninguém mais vai buscar. Ficar PARCIAL não é
// empate, é o Norte/Nordeste ficando de fora da base.
//
// POR QUE NÃO SÓ AUMENTAR O ORÇAMENTO. Porque os 330min são o que mantém cada
// passada interrompível e com checkpoint gravado (ver o comentário do
// etl-refresh.mjs sobre as 12h12 dentro de uma janela de 6h). Aqui cada passada
// continua curta; o laço é que insiste.
//
// A CHAVE DO CHECKPOINT DEPENDE DA DATA DA MÁQUINA. O etl-pncp.mjs monta
// `uf:UF:mod:M:d<dataInicial>` com dataInicial = hoje − DIAS. Se o laço cruzar a
// meia-noite da máquina, a passada seguinte pede uma janela NOVA e recomeça de SP,
// jogando fora o progresso das UFs já fechadas. Por isso o laço para no virar do dia.
//
// PASSADAS × ExecutionTimeLimit: 3 × 330min = 16h30, que cabe no PT18H da tarefa
// agendada. Subir o teto sem subir o PT18H faria o Scheduler matar a tarefa no meio.
//
// Uso:  node scripts/etl-refresh-loop.mjs
// Env:  ETL_PASSADAS=3   (teto de passadas)
//       + todas as do etl-refresh.mjs (ETL_DIAS, ETL_DELAY, ETL_ORCAMENTO_MIN, ETL_UF)

import { spawn } from 'node:child_process'
import { pegar, soltar, soltarNaSaida, estado } from './pncp-lock.mjs'

const MAX_PASSADAS = Number(process.env.ETL_PASSADAS ?? 3)
const ts = () => new Date().toLocaleString('pt-BR')
const log = (m) => console.log(`[loop] ${m}`)

// Dia da MÁQUINA (não UTC, não BRT): é o mesmo relógio que o etl-pncp.mjs usa para
// montar a janela, então é ele que decide quando a chave do checkpoint muda.
const diaMaquina = () => {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** Roda uma passada. Repassa a saída em tempo real (o log da tarefa continua
 *  legível) E procura o marcador de conclusão — o etl-refresh.mjs sai 0 tanto no
 *  completo quanto no PARCIAL de propósito, para o Scheduler não acusar falha, então
 *  o código de saída NÃO distingue os dois casos. O texto distingue. */
function passada() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/etl-refresh.mjs'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let completou = false
    const olhar = (buf) => {
      const s = buf.toString()
      process.stdout.write(s)
      if (s.includes('concluído com sucesso')) completou = true
    }
    p.stdout.on('data', olhar)
    p.stderr.on('data', olhar)
    p.on('exit', (code) => resolve({ code: code ?? 1, completou }))
    p.on('error', (e) => {
      console.error('[loop] falha ao iniciar a passada:', e?.message ?? e)
      resolve({ code: 1, completou: false })
    })
  })
}

// Se outro dono legítimo estiver com a pista, não empilhamos em cima dele.
const antes = estado()
if (antes.ocupado) {
  log(`a pista já está com ${antes.dono} — saindo sem rodar.`)
  process.exit(0)
}
if (antes.motivo) log(antes.motivo)

soltarNaSaida()
pegar('etl-refresh-loop')

const diaInicial = diaMaquina()
log(`início ${ts()} — até ${MAX_PASSADAS} passadas, dia da máquina ${diaInicial}`)

let n = 0
let fechou = false
while (n < MAX_PASSADAS) {
  n++
  log(`passada ${n}/${MAX_PASSADAS} — ${ts()}`)
  const { code, completou } = await passada()

  if (completou) { fechou = true; log(`janela FECHADA na passada ${n} — ${ts()}`); break }
  if (diaMaquina() !== diaInicial) {
    log(`o dia da máquina virou (${diaInicial} → ${diaMaquina()}): parando aqui.`)
    log('outra passada abriria uma janela NOVA e recomeçaria de SP, perdendo as UFs já fechadas.')
    break
  }
  if (code !== 0) log(`passada ${n} saiu com código ${code} — o checkpoint guardou o progresso.`)
  log(`passada ${n} terminou PARCIAL; emendando a próxima na mesma janela.`)
}

if (!fechou && n >= MAX_PASSADAS) log(`teto de ${MAX_PASSADAS} passadas atingido sem fechar a janela.`)
log(`fim ${ts()} — ${n} passada(s), janela ${fechou ? 'FECHADA' : 'ainda incompleta'}.`)
soltar()
process.exit(0)
