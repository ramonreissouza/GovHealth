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
import { soltar, soltarNaSaida, estado } from './pncp-lock.mjs'
import { CODIGO_CEDER, ceder, esperarVez, limparNaSaida, trabalhandoDesdeMs } from './pncp-prioridade.mjs'

const MAX_PASSADAS = Number(process.env.ETL_PASSADAS ?? 3)
// Quem este processo E na fila da pista. Existem DUAS tarefas agendadas rodando este
// mesmo script com janelas diferentes: a curta (a cada 2 dias, poucos dias de janela,
// prioridade 15) e a longa (a cada 3 dias, 21 dias, prioridade 20). Sem nomes distintos
// as duas teriam a mesma prioridade e a curta ficaria atras da longa por ate 16h nos
// dias em que coincidem — perdendo exatamente o frescor que ela existe para garantir.
const DONO = process.env.ETL_DONO ?? 'etl-refresh-loop'
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
      // PNCP_DONO desce por AMBIENTE, não por flag, porque entre este processo e o
      // etl-pncp que de fato varre existe o etl-refresh no meio. Por flag eu teria de
      // costurar o repasse em cada nível; por ambiente, herda sozinho até o fim.
      env: { ...process.env, PNCP_DONO: DONO, PNCP_TRABALHANDO_DESDE: String(trabalhandoDesdeMs()) },
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

// ESPERAR, NÃO DESISTIR. Até 05/09/2026 este bloco saía sem rodar quando encontrava a
// pista ocupada, e o custo disso está no próprio log: em 31/08 ele registrou "a pista
// já está com backfill-2025h1 — saindo sem rodar" e a próxima chance só veio três dias
// depois. Para o alimentador principal da base, perder a janela é pior que esperar.
//
// Desistir fazia sentido quando a pista era primeiro-a-chegar e esperar significava
// ficar horas atrás de um trabalho adiável. Agora ele entra na fila com prioridade 20:
// passa na frente de enriquecer, mutirões e itens, e só espera pelo sync-cobertura,
// que roda em minutos.
const antes = estado()
if (antes.motivo) log(antes.motivo)
if (antes.ocupado) log(`pista com ${antes.dono} — entro na fila em vez de desistir`)

soltarNaSaida()
limparNaSaida()
// Sem teto: quem pediu esta tarefa quer a janela coletada, não uma tentativa.
await esperarVez(DONO, { log })

const diaInicial = diaMaquina()
log(`início ${ts()} — até ${MAX_PASSADAS} passadas, dia da máquina ${diaInicial}`)

let n = 0
let fechou = false
let cessoes = 0
// Teto de cessões porque o contrário é pior que o problema: sem ele, um consumidor
// urgente que acorda de tempos em tempos poderia manter este loop cedendo a noite
// inteira sem nunca fechar a janela — fila justa que não entrega nada. O piso de
// trabalho do pncp-prioridade já espaça as cessões; isto é o limite de última linha.
const MAX_CESSOES = 5
while (n < MAX_PASSADAS) {
  n++
  log(`passada ${n}/${MAX_PASSADAS} — ${ts()}`)
  const { code, completou } = await passada()

  if (completou) { fechou = true; log(`janela FECHADA na passada ${n} — ${ts()}`); break }

  // Passagem não é falha nem passada gasta: a varredura parou num limite de página,
  // com checkpoint gravado. Devolvo a pista, espero minha vez e retomo do mesmo ponto.
  if (code === CODIGO_CEDER && cessoes < MAX_CESSOES) {
    cessoes++
    // Sem a pista de volta não há passada: seguir aqui foi o que pôs duas frentes no
    // PNCP ao mesmo tempo em 06/09. O checkpoint guarda o progresso; a próxima execução
    // agendada retoma da mesma janela.
    if (!(await ceder(DONO, { log }))) {
      log('não retomei a pista — paro aqui em vez de varrer por cima de quem está nela.')
      break
    }
    n-- // não conta contra o teto de passadas: ela foi interrompida, não fracassou
    continue
  }
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
