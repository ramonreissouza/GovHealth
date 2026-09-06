// scripts/etl-refresh.mjs — REFRESH INCREMENTAL (a cada 3 dias) do ETL do PNCP.
//
// Diferente do etl-overnight (scan histórico de 12 meses com cap por UF), este
// pega só a janela RECENTE (default 21 dias) em TODAS as 27 UFs, SEM cap, para
// capturar as contratações de saúde novas/atualizadas desde o último refresh.
// É idempotente (UPSERT): contratos já no banco são pulados barato (jaProcessada).
//
// Janela de 21 dias cobre a cadência de 3 dias com folga ampla p/ publicações
// atrasadas do PNCP. Checkpoint é isolado por janela (--dias), então não conflita
// com o scan histórico.
//
// ORDEM DAS UFs: dos MAIORES estados (mais contratações de saúde) para os menores,
// então uma interrupção preserva primeiro o que mais importa (SP, RJ, MG…).
//
// Uso:  node scripts/etl-refresh.mjs
//   Ajuste fino por env: ETL_DIAS=21  ETL_DELAY=120  ETL_UF=SP,RJ,...
//
// Pensado para rodar via Windows Task Scheduler a cada 3 dias.

import { spawn } from 'node:child_process'
import { CODIGO_CEDER } from './pncp-prioridade.mjs'

// 27 UFs, priorizadas dos maiores estados para os menores (economia/volume de saúde).
const UF = process.env.ETL_UF ?? 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR'
const DIAS = process.env.ETL_DIAS ?? '21'
const DELAY = process.env.ETL_DELAY ?? '120'
const NOCAP = '99999999' // sem teto: pega tudo que for saúde na janela
const ARGS = ['scripts/etl-pncp.mjs', `--uf=${UF}`, `--dias=${DIAS}`, `--max=${NOCAP}`, `--delay=${DELAY}`]
const MAX_TENTATIVAS = 100

// ORÇAMENTO DE TEMPO — por que existe (medido, não estimado):
// A tarefa "GovHealth ETL Refresh" tem ExecutionTimeLimit=PT6H, mas a ação é
// `cmd.exe /c "node.exe scripts\etl-refresh.mjs >> etl-refresh.log"`. O limite
// derruba o cmd.exe e o node NÃO vai com ele: fica órfão e continua trabalhando.
// Na execução de 16/08/2026 a tarefa reportou 267014 (SCHED_S_TASK_TERMINATED)
// às 09:00 e o node seguiu até `✓ concluído com sucesso em 16/08/2026, 15:12` —
// 12h12 de execução real dentro de uma janela de 6h. Duas consequências ruins:
//   1. o código de resultado da tarefa passa a MENTIR (falha reportada, trabalho
//      concluído), e foi o que me fez diagnosticar "base sem refresh desde 13/08";
//   2. meia jornada de ETL fica batendo no PNCP sem supervisão, ao lado do harvest
//      do pipeline-noite — que existe justamente para ser o ÚNICO dono do PNCP.
// Com o orçamento abaixo do limite da tarefa, o node termina primeiro, o cmd sai
// junto, e o código de resultado volta a significar alguma coisa.
//
// Sair no meio é seguro e NÃO perde trabalho: o etl-pncp guarda checkpoint por
// (UF, janela) e só avança depois de gravar a página inteira; a gravação é UPSERT.
// O pior caso é repetir a última página na próxima execução.
const ORCAMENTO_MIN = Number(process.env.ETL_ORCAMENTO_MIN ?? 330) // 5h30 < PT6H
const FIM = Date.now() + ORCAMENTO_MIN * 60 * 1000
const restaMs = () => FIM - Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ts = () => new Date().toLocaleString('pt-BR')
let estourou = false
function rodar() {
  return new Promise((resolve) => {
    const p = spawn('node', ARGS, { stdio: 'inherit' })
    // Uma passada só já levou 12h — o corte tem que valer DURANTE a passada, não
    // apenas entre passadas, senão o orçamento não segura nada.
    const corte = setTimeout(() => { estourou = true; p.kill() }, Math.max(0, restaMs()))
    p.on('exit', (code) => { clearTimeout(corte); resolve(code ?? 1) })
    p.on('error', () => { clearTimeout(corte); resolve(1) })
  })
}

/** Fim de orçamento é conclusão parcial ESPERADA, não falha: sai 0 para o
 *  Scheduler, com o log dizendo em voz alta que faltou terminar. */
function pararParcial(motivo) {
  console.log(`\n[refresh] orçamento de ${ORCAMENTO_MIN}min encerrado (${motivo}) em ${ts()}.`)
  console.log('[refresh] PARCIAL — o checkpoint guardou o progresso; a próxima execução retoma daqui.')
}

console.log(`[refresh] início ${ts()} — janela=${DIAS}d UFs=${UF.split(',').length} delay=${DELAY}ms`
  + ` orçamento=${ORCAMENTO_MIN}min`)
let tentativa = 0
while (tentativa < MAX_TENTATIVAS) {
  tentativa++
  console.log(`\n=== [refresh] tentativa ${tentativa}/${MAX_TENTATIVAS} — ${ts()}`
    + ` (restam ${Math.round(restaMs() / 60000)}min de orçamento) ===`)
  const code = await rodar()
  if (estourou) { pararParcial('passada interrompida no meio'); break }
  // Passagem pedida por alguém mais urgente. Aqui NÃO dá para ceder: quem tem o lock
  // é o etl-refresh-loop, dois níveis acima. Repassar o código é o único jeito de a
  // decisão chegar em quem pode tomá-la — e retentar em 30s, como faria com um erro
  // qualquer, só recomeçaria a passada com a pista ainda presa.
  if (code === CODIGO_CEDER) {
    console.log('\n[refresh] passagem pedida — devolvendo ao loop, que solta a pista e retoma daqui.')
    process.exit(CODIGO_CEDER)
  }
  if (code === 0) { console.log(`\n[refresh] ✓ concluído com sucesso em ${ts()}.`); break }
  if (tentativa >= MAX_TENTATIVAS) { console.log('\n[refresh] limite de tentativas atingido — rode de novo para continuar (retoma pelo checkpoint).'); break }
  // Não entra numa passada nova sem tempo de fazer algo útil com ela.
  if (restaMs() <= 60000) { pararParcial('sem tempo para outra passada'); break }
  console.log(`[refresh] saiu com código ${code}. Retomando em 30s (checkpoint preserva o progresso)…`)
  await sleep(30000)
}
