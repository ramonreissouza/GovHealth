// scripts/backfill-2025h1.mjs — re-varre jan–jun/2025, que entrou na base pela metade.
//
// POR QUE ISSO EXISTE (medido em 30/08/2026, não estimado).
//
// A régua de dias do sync-cobertura diz que está tudo certo, e ela não está mentindo:
// entre 01/01/2025 e hoje são 608 dias e ZERO dias úteis vazios. O problema é que a
// régua conta DIAS, e o buraco é de LINHAS dentro de dias que parecem cheios.
//
// Amostra de uma terça por mês (SP, pregão eletrônico), perguntando ao PNCP o que ele
// publicou e conferindo quanto disso está gravado:
//
//     2025-01  faltam 59%      2025-07  faltam  0%
//     2025-02  faltam 43%      2025-08  faltam  1%
//     2025-03  faltam 37%      2025-09  faltam  1%
//     2025-04  faltam 36%      2025-10  faltam  3%
//     2025-05  faltam 35%      ...      0-3%
//     2025-06  faltam 30%      2026-08  faltam  0%
//
// O corte em 01/07/2025 é ABRUPTO, não um degradê — é até onde a varredura histórica
// alcançou. Antes disso a base tem o que os alimentadores incrementais pegaram de
// passagem, e não uma coleta de verdade.
//
// DUAS EXPLICAÇÕES FÁCEIS FORAM DESCARTADAS, MEDINDO:
//
//   1) Não é o filtro de saúde ter melhorado depois. As linhas de 08/04/2025 foram
//      gravadas em 05/08/2026, DEPOIS das mudanças de filtro de 04/08/2026, e mesmo
//      assim faltam 34 de 95 que o filtro de hoje aprova.
//
//   2) Não é teto de paginação. Os que faltam se concentram nas PRIMEIRAS páginas do
//      dia (11, 10, 9, 2, 1, 1, 0). Uma coleta que para cedo corta o FIM, não o começo.
//
// SP/PREGÃO É O PIOR CASO, NÃO A MÉDIA. No mesmo período: MG 11-13%, BA 0%, SP
// dispensa 15%. Por isso este script não promete um número: ele varre e conta.
//
// É `--soCabecalho` DE PROPÓSITO. Uma chamada por página de 50, sem descer em itens
// nem resultados. Trazer a LINHA que não existe é o que muda a tela do cliente;
// enriquecer o que já existe é outro passe, e misturar os dois faria uma varredura de
// 3h virar uma de 40h — e nenhuma das duas terminaria.
//
// FATIA DE MEIO MÊS, e isso não é preciosismo. A paginação profunda do PNCP quebra
// (o etl-pncp tem disjuntor para isso). Meio mês de uma UF grande dá ~130 páginas;
// o mês inteiro dobraria, e cada quebra custa a cauda daquela UF/modalidade.
//
// ESPERA A PISTA. Duas frentes no PNCP ao mesmo tempo dão 429 — medido em 21/08/2026:
// 18× HTTP 429 e 14× 503 com refresh e harvest juntos, contra 4 quedas em 485 páginas
// rodando um de cada vez. Enquanto eu escrevia isto, 14 sondas minúsculas concorrendo
// com o backfill-itens já levaram 429 na oitava.
//
// Uso:
//   node scripts/backfill-2025h1.mjs --ensaio      (só mostra o plano; não toca em nada)
//   node scripts/backfill-2025h1.mjs               (espera a pista e varre)
//   node scripts/backfill-2025h1.mjs --de=2025-03-01 --ate=2025-04-30
//
// DEPOIS DE RODAR: `npm run ruido:limpar -- --so-valor --aplicar`. Toda coleta nova
// ressuscita as linhas de valor impossível que já haviam sido neutralizadas.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { estado, pegar, soltar, soltarNaSaida } from './pncp-lock.mjs'

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : d
}
const ENSAIO = process.argv.includes('--ensaio')
const SEM_LOCK = process.argv.includes('--sem-lock')
const DE = arg('de', '2025-01-01')
const ATE = arg('ate', '2025-06-30')
const DELAY = arg('delay', '400')
// 0 = espera para sempre. Ao contrário do backfill-itens, que roda todo dia e pode
// desistir de hoje, este é um mutirão único: desistir significa não acontecer.
const ESPERA_MAX_MIN = Number(arg('espera-max', '0'))
const MAXPAG = arg('maxpag', '400')

// Todas as 27 UFs. Conferido na base: as 6 modalidades aparecem em jan–jun/2025 na
// mesma proporção do resto do ano, então o buraco NÃO é de modalidade — mas varrer
// só 6,8 (o padrão do etl-pncp) deixaria Inexigibilidade e Credenciamento de fora,
// que juntas são 15.731 linhas do período.
const UFS = 'SP,RJ,MG,RS,PR,BA,SC,GO,PE,CE,DF,ES,PA,MT,MS,AM,MA,RN,PB,PI,AL,SE,RO,TO,AC,AP,RR'
const MODALIDADES = '4,5,6,8,9,12'
const NOMES_ESPERADOS = {
  4: 'Concorrência - Eletrônica', 5: 'Concorrência - Presencial', 6: 'Pregão - Eletrônico',
  8: 'Dispensa', 9: 'Inexigibilidade', 12: 'Credenciamento',
}

const ts = () => new Date().toLocaleString('pt-BR')
const log = (m) => console.log(`[backfill-2025h1] ${ts()} — ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!process.env.DATABASE_URL) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue
    const m = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) { process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, ''); break }
  }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// ── fatias de meio mês ───────────────────────────────────────────────────────
function fatias(de, ate) {
  const out = []
  const ini = new Date(de + 'T00:00:00Z'), fim = new Date(ate + 'T00:00:00Z')
  for (let d = new Date(ini); d <= fim;) {
    const ano = d.getUTCFullYear(), mes = d.getUTCMonth()
    const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
    const corte = d.getUTCDate() <= 15 ? 15 : ultimoDia
    const a = new Date(d)
    const b = new Date(Date.UTC(ano, mes, Math.min(corte, ultimoDia)))
    out.push([a.toISOString().slice(0, 10), (b > fim ? fim : b).toISOString().slice(0, 10)])
    d = new Date(Date.UTC(ano, mes, corte + 1))
  }
  return out
}
const PLANO = fatias(DE, ATE)

// ── retrato do antes/depois ──────────────────────────────────────────────────
async function retrato() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    `SELECT to_char(date_trunc('month', data_publicacao),'YYYY-MM') mes, count(*)::int n
       FROM contratacoes WHERE data_publicacao BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [DE, ATE])
  await c.end()
  return new Map(rows.map((r) => [r.mes, r.n]))
}

// ── confere que cada código de modalidade é o que eu acho que é ──────────────
// Chutar aqui é o erro que não dá erro: um código errado varre uma modalidade que
// não interessa (ou nenhuma) e termina com "sucesso", só trazendo menos.
async function conferirCodigos() {
  log('conferindo os códigos de modalidade contra o PNCP…')
  for (const mod of MODALIDADES.split(',')) {
    const sp = new URLSearchParams({
      dataInicial: '20250513', dataFinal: '20250513', codigoModalidadeContratacao: mod,
      uf: 'SP', pagina: '1', tamanhoPagina: '10',
    })
    let nome = '(sem registros nesse dia)'
    try {
      const r = await fetch(`https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?${sp}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (r.ok) { const j = await r.json(); nome = j.data?.[0]?.modalidadeNome ?? nome }
      else nome = `HTTP ${r.status}`
    } catch { nome = 'falhou' }
    const esperado = NOMES_ESPERADOS[mod]
    const bate = nome === esperado ? 'ok' : `ATENÇÃO: eu esperava "${esperado}"`
    log(`  ${String(mod).padStart(2)} → ${nome}   ${bate}`)
    await sleep(2000)
  }
}

// ── uma fatia ────────────────────────────────────────────────────────────────
function varrer(de, ate) {
  return new Promise((resolve) => {
    const args = [
      path.join('scripts', 'etl-pncp.mjs'),
      `--uf=${UFS}`,
      `--dataInicial=${de.replace(/-/g, '')}`,
      `--dataFinal=${ate.replace(/-/g, '')}`,
      `--modalidades=${MODALIDADES}`,
      '--max=99999999',      // sem teto: o teto é justamente o que criou o buraco
      `--maxpag=${MAXPAG}`,
      `--delay=${DELAY}`,
      '--soCabecalho',
    ]
    const p = spawn(process.execPath, args, { stdio: 'inherit' })
    p.on('exit', (code) => resolve(code ?? 0))
    p.on('error', (e) => { log(`falhou ao iniciar: ${e.message}`); resolve(1) })
  })
}

// ── principal ────────────────────────────────────────────────────────────────
log(`período ${DE} → ${ATE} · ${PLANO.length} fatia(s) · ${UFS.split(',').length} UFs · modalidades ${MODALIDADES}`)
for (const [a, b] of PLANO) log(`  fatia: ${a} → ${b}`)

if (ENSAIO) { log('ensaio: nada foi executado.'); process.exit(0) }

if (!SEM_LOCK) {
  const inicio = Date.now()
  let n = 0
  while (estado().ocupado) {
    const e = estado()
    if (ESPERA_MAX_MIN && (Date.now() - inicio) / 60000 >= ESPERA_MAX_MIN) {
      log(`pista ainda ocupada por "${e.dono}" — desisto`); process.exit(0)
    }
    log(`pista ocupada por "${e.dono}" — espera ${++n}, novo teste em 10min`)
    await sleep(10 * 60 * 1000)
  }
  pegar('backfill-2025h1')
  soltarNaSaida()
  log('pista tomada.')
}

const antes = await retrato()
await conferirCodigos()

let falhas = 0
for (const [i, [a, b]] of PLANO.entries()) {
  log(`━━━ fatia ${i + 1}/${PLANO.length}: ${a} → ${b} ━━━`)
  const code = await varrer(a, b)
  if (code !== 0) { falhas++; log(`fatia ${a}→${b} saiu com código ${code} — sigo para a próxima`) }
}

const depois = await retrato()
log('━━━ RESULTADO ━━━')
log('mês        antes    depois    ganho')
let ga = 0, gd = 0
for (const mes of [...new Set([...antes.keys(), ...depois.keys()])].sort()) {
  const a = antes.get(mes) ?? 0, d = depois.get(mes) ?? 0
  ga += a; gd += d
  log(`${mes}   ${String(a).padStart(6)}   ${String(d).padStart(6)}   ${String(d - a).padStart(6)}`)
}
log(`TOTAL     ${String(ga).padStart(6)}   ${String(gd).padStart(6)}   ${String(gd - ga).padStart(6)}`)
if (falhas) log(`${falhas} fatia(s) saíram com erro — rode de novo, os checkpoints retomam de onde pararam.`)
log('AGORA RODE: npm run ruido:limpar -- --so-valor --aplicar')
if (!SEM_LOCK) soltar()
