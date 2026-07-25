// scripts/etl-backfill.mjs — COBERTURA NACIONAL fatiada por TEMPO (recente→antigo) e
// PARALELIZADA por GRUPOS de UFs. Espalha o país o mais rápido e uniforme possível:
//
//  - Fatias curtas (ETL_FATIA dias, default 15), da MAIS RECENTE para a mais antiga →
//    o dado atual/aberto entra primeiro.
//  - Em CADA fatia, as 27 UFs são divididas em ETL_GRUPOS grupos (default 4) que rodam
//    em PARALELO (um processo etl-pncp por grupo). Assim o estado gigante (SP) churna
//    num grupo enquanto os outros 26 avançam nos demais — em vez de o SP monopolizar.
//
// Grava cabeçalho + itens + resultados + as 3 datas de proposta. Idempotente (UPSERT +
// checkpoint por range uf:UF:mod:M:rINI_FIM) e resiliente (retoma pelo checkpoint).
// NÃO conflita com o refresh (chave por --dias).
//
// Uso:  npm run etl:backfill
//   ETL_ANOS=2026,2025,2024   até onde volta no tempo
//   ETL_FATIA=15              dias por fatia
//   ETL_GRUPOS=4              nº de processos paralelos (grupos de UFs)
//   ETL_MODALIDADES=4,5,6,8,9,12 · ETL_MAXPAG=2000 · ETL_DELAY=250 (por processo)
//
// PESADO E LONGO (dias). Deixe rodando; se cair, rode de novo que retoma.

import { spawn } from 'node:child_process'

const ANOS = (process.env.ETL_ANOS ?? '2026,2025,2024').split(',').map((s) => Number(s.trim())).filter(Boolean)
const MODALIDADES = process.env.ETL_MODALIDADES ?? '4,5,6,8,9,12'
const MAXPAG = process.env.ETL_MAXPAG ?? '2000'
// Delay MAIOR por processo (250ms) porque há vários em paralelo — protege o rate-limit.
const DELAY = process.env.ETL_DELAY ?? '400'
const FATIA = Math.max(Number(process.env.ETL_FATIA ?? 15), 1)
// 2 grupos = espalha (2 gigantes em paralelo) sem estourar o rate-limit do PNCP, que
// se mostrou rígido. Ajustável via ETL_GRUPOS; 4+ tende a gerar 429/outage sustentado.
const GRUPOS = Math.max(Number(process.env.ETL_GRUPOS ?? 2), 1)
// Passe leve por padrão (cabeçalho + datas): espalha o país rápido sem estourar rate-limit.
// Desligue (ETL_SO_CABECALHO=0) para um passe de enriquecimento profundo (itens/resultados).
const SO_CABECALHO = process.env.ETL_SO_CABECALHO !== '0'
const MAX_TENTATIVAS = 1000

// UFs em ordem de VOLUME (maior→menor). Round-robin nessa ordem balanceia a carga:
// cada grupo recebe um dos gigantes + médios + pequenos.
const UF_POR_VOLUME = (process.env.ETL_UF ??
  'SP,MG,GO,BA,RJ,CE,ES,DF,AM,RS,PR,MA,PE,SC,PA,AL,PB,RN,MS,PI,SE,TO,MT,RO,AC,RR,AP')
  .split(',').map((s) => s.trim()).filter(Boolean)

// Distribui as UFs em GRUPOS balanceados (round-robin sobre a ordem por volume).
const grupos = Array.from({ length: GRUPOS }, () => [])
UF_POR_VOLUME.forEach((uf, i) => grupos[i % GRUPOS].push(uf))

const ts = () => new Date().toLocaleString('pt-BR')
const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

// Fatias [di,df] de FATIA dias, do MAIS RECENTE (hoje) até 01/01 do ano mais antigo.
function fatias() {
  const out = []
  const hoje = new Date()
  const limite = new Date(`${Math.min(...ANOS)}-01-01T00:00:00`)
  let df = hoje
  while (df >= limite) {
    const di = new Date(Math.max(df.getTime() - (FATIA - 1) * 86400000, limite.getTime()))
    out.push([fmt(di), fmt(df)])
    df = new Date(di.getTime() - 86400000)
  }
  return out
}

// Roda um etl-pncp para um GRUPO de UFs numa janela, com retry por checkpoint.
function rodarGrupo(ufs, di, df) {
  const args = ['scripts/etl-pncp.mjs', `--uf=${ufs.join(',')}`, `--dataInicial=${di}`, `--dataFinal=${df}`,
    `--modalidades=${MODALIDADES}`, '--max=99999999', `--maxpag=${MAXPAG}`, `--delay=${DELAY}`]
  // Passe LEVE (cabeçalho + datas, sem itens/resultados) → permite paralelizar sem 429.
  // Enriquecimento profundo fica para depois (ETL_SO_CABECALHO=0 ou o refresh).
  if (SO_CABECALHO) args.push('--soCabecalho')
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: 'inherit' })
    p.on('exit', (code) => resolve(code ?? 1))
    p.on('error', () => resolve(1))
  })
}

async function processarGrupoNaFatia(ufs, di, df) {
  let tentativa = 0
  while (tentativa < MAX_TENTATIVAS) {
    tentativa++
    const code = await rodarGrupo(ufs, di, df)
    if (code === 0) return
    if (tentativa >= MAX_TENTATIVAS) return
    await new Promise((r) => setTimeout(r, 30000))
  }
}

const SLICES = fatias()
console.log(`[backfill] início ${ts()} — anos=${ANOS.join(',')} · ${SLICES.length} fatias de ${FATIA}d (recente→antigo) · ${GRUPOS} grupos paralelos · modalidades=${MODALIDADES} · delay=${DELAY}ms/proc · modo=${SO_CABECALHO ? 'LEVE (cabeçalho+datas)' : 'COMPLETO (itens+resultados)'}`)
grupos.forEach((g, i) => console.log(`  grupo ${i + 1}: ${g.join(',')}`))

for (let i = 0; i < SLICES.length; i++) {
  const [di, df] = SLICES[i]
  console.log(`\n########## FATIA ${i + 1}/${SLICES.length}: ${di}→${df} — ${GRUPOS} grupos em paralelo — ${ts()} ##########`)
  // Os grupos rodam em PARALELO; a fatia só avança quando todos terminam.
  await Promise.all(grupos.map((ufs) => processarGrupoNaFatia(ufs, di, df)))
  console.log(`[backfill] ✓ fatia ${di}→${df} concluída (todos os grupos) em ${ts()}.`)
}
console.log(`\n[backfill] ✓ TODAS as ${SLICES.length} fatias processadas em ${ts()}.`)
