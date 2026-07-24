// scripts/etl-backfill.mjs — BACKFILL HISTÓRICO PROFUNDO, fatiado por ANO, SEM TETO.
//
// Por que fatiado por ano: o PNCP limita a janela a ~1 ano por consulta (range de
// 3 anos → HTTP 422) e pagina do MAIS ANTIGO para o mais novo. Então varremos ano a
// ano, na ordem de prioridade (2026 → 2025 → 2024), todas as 27 UFs (grandes
// primeiro), modalidades ampliadas, sem teto de contratações e com teto de páginas
// alto (varre anos inteiros dos estados grandes — ex.: SP/2024 tem ~1.400 páginas).
//
// Resiliente: retoma pelo checkpoint (chave por range, uf:UF:mod:M:rINI_FIM) e
// reinicia sozinho em quedas. Idempotente (UPSERT + jaProcessada). NÃO conflita com
// o refresh de 3 em 3 dias (chave por --dias).
//
// Uso:  npm run etl:backfill
//   Ajuste fino por env:
//     ETL_ANOS=2026,2025,2024      anos e ordem de prioridade
//     ETL_UF=SP,RJ,...             seleção/ordem de UFs (default: grandes → pequenas)
//     ETL_MODALIDADES=4,5,6,8,9,12 4=concorrência elet, 5=concorrência pres,
//                                  6=pregão elet, 8=dispensa, 9=inexigibilidade, 12=credenciamento
//     ETL_MAXPAG=2000              teto de páginas por UF/modalidade/ano
//     ETL_DELAY=150                ms entre chamadas ao PNCP
//
// PESADO E LONGO (dias). Deixe rodando; se cair, rode de novo que retoma.

import { spawn } from 'node:child_process'

const ANOS = (process.env.ETL_ANOS ?? '2026,2025,2024').split(',').map((s) => s.trim()).filter(Boolean)
const UF = process.env.ETL_UF ?? 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR'
const MODALIDADES = process.env.ETL_MODALIDADES ?? '4,5,6,8,9,12'
const MAXPAG = process.env.ETL_MAXPAG ?? '2000'
const DELAY = process.env.ETL_DELAY ?? '150'
const MAX_TENTATIVAS = 1000

const ts = () => new Date().toLocaleString('pt-BR')
const hojeStr = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` }
const anoCorrente = new Date().getFullYear()

function rodar(di, df) {
  const args = ['scripts/etl-pncp.mjs', `--uf=${UF}`, `--dataInicial=${di}`, `--dataFinal=${df}`,
    `--modalidades=${MODALIDADES}`, '--max=99999999', `--maxpag=${MAXPAG}`, `--delay=${DELAY}`]
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: 'inherit' })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

console.log(`[backfill] início ${ts()} — anos=${ANOS.join(',')} · UFs=${UF.split(',').length} · modalidades=${MODALIDADES} · maxpag=${MAXPAG} · SEM TETO · delay=${DELAY}ms`)
for (const ano of ANOS) {
  const di = `${ano}0101`
  const df = Number(ano) >= anoCorrente ? hojeStr() : `${ano}1231`
  console.log(`\n########## ANO ${ano} (${di}→${df}) — ${ts()} ##########`)
  let tentativa = 0
  while (tentativa < MAX_TENTATIVAS) {
    tentativa++
    console.log(`\n=== [backfill ${ano}] tentativa ${tentativa}/${MAX_TENTATIVAS} — ${ts()} ===`)
    const code = await rodar(di, df)
    if (code === 0) { console.log(`\n[backfill ${ano}] ✓ concluído em ${ts()}.`); break }
    if (tentativa >= MAX_TENTATIVAS) { console.log(`\n[backfill ${ano}] limite de tentativas — rode de novo p/ continuar (retoma pelo checkpoint).`); break }
    console.log(`[backfill ${ano}] saiu com código ${code}. Retomando em 30s…`)
    await new Promise((r) => setTimeout(r, 30000))
  }
}
console.log(`\n[backfill] ✓ TODOS os anos processados em ${ts()}.`)
