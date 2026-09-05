// scripts/sonda-pncp.mjs — quanto do que o PNCP publicou está de fato na nossa base?
//
// POR QUE ISSO EXISTE.
//
// O `sync-cobertura` pergunta ao BANCO quais dias estão magros. É uma régua honesta,
// mas mede o banco contra ele mesmo: compara cada dia com a mediana dos outros dias.
// Um período coletado pela metade INTEIRO passa despercebido — foi exatamente o que
// aconteceu com jan–jun/2025, onde faltavam 30-59% das linhas e não havia um único dia
// útil vazio em 608 dias.
//
// Esta sonda mede contra a FONTE: pergunta ao PNCP o que ele publicou naquele dia,
// aplica o filtro de saúde ATUAL e confere quantas dessas já estão gravadas. É a única
// medida que responde "falta alguma coisa?" sem depender do que já temos.
//
// USE ANTES DE MANDAR UM MUTIRÃO. Uma varredura de período é cara (jan–jun/2025 levou
// ~30h de pista). Amostrar 6 dias custa minutos e diz se vale a pena — e, mais
// importante, diz QUANTO falta, o que nenhuma estimativa a priori acertou até hoje.
//
// COMO LER O RESULTADO. A amostra é de UF+modalidade, não da base inteira: SP/pregão
// foi o PIOR caso em jan–jun/2025 (36%) enquanto MG ficava em 11-13% e BA em 0%. Um
// número alto aqui é motivo para investigar, não para extrapolar. Amostre mais de uma
// UF antes de concluir.
//
// Uso:
//   node scripts/sonda-pncp.mjs --datas=2024-03-12,2024-06-11,2024-09-10
//   node scripts/sonda-pncp.mjs --datas=2024-03-12 --ufs=SP,MG,BA --mods=6,8
//   node scripts/sonda-pncp.mjs --mensal=2024          (uma terça por mês do ano)
//
// CUIDADO: sonda usa a mesma pista que a coleta. Rodar isto junto de um mutirão dá 429
// — medido em 30/08/2026, 14 sondas concorrendo com o backfill-itens levaram 429 na
// oitava. Confira `.pncp-ocupado` antes, ou rode com a pista livre.

import fs from 'node:fs'
import pg from 'pg'
import { isSaude } from './saude-filter.mjs'
import { estado } from './pncp-lock.mjs'

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`))
  return m ? m.slice(n.length + 3) : d
}
const UFS = String(arg('ufs', 'SP')).toUpperCase().split(',').filter(Boolean)
const MODS = String(arg('mods', '6,8')).split(',').filter(Boolean)
const MAXPAG = Number(arg('maxpag', '40'))
const DELAY = Number(arg('delay', '1200'))
const IGNORAR_PISTA = process.argv.includes('--sem-lock')

/** Uma terça-feira por mês do ano — dia útil "médio", longe de segunda e sexta. */
function tercasDoAno(ano) {
  const out = []
  for (let mes = 0; mes < 12; mes++) {
    const d = new Date(Date.UTC(ano, mes, 1))
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCDate(d.getUTCDate() + 7) // a 2ª terça: a 1ª às vezes cai em feriado/virada
    if (d.getUTCMonth() === mes && d <= new Date()) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const MENSAL = arg('mensal', null)
const DATAS = MENSAL ? tercasDoAno(Number(MENSAL)) : String(arg('datas', '')).split(',').filter(Boolean)
if (!DATAS.length) {
  console.error('ERRO: informe --datas=YYYY-MM-DD,... ou --mensal=YYYY')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue
    const m = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) { process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, ''); break }
  }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const e = estado()
if (e.ocupado && !IGNORAR_PISTA) {
  console.error(`ERRO: a pista está com "${e.dono}". Sondar junto de uma coleta dá 429.`)
  console.error('      Espere terminar, ou passe --sem-lock se souber o que está fazendo.')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Todas as contratações que o PNCP tem para (dia, uf, modalidade). */
async function doPncp(dia, uf, mod) {
  const out = []
  for (let pagina = 1; pagina <= MAXPAG; pagina++) {
    const sp = new URLSearchParams({
      dataInicial: dia.replace(/-/g, ''), dataFinal: dia.replace(/-/g, ''),
      codigoModalidadeContratacao: String(mod), uf, pagina: String(pagina), tamanhoPagina: '50',
    })
    let j = null
    let parcial = false
    for (let t = 0; t < 4 && !j; t++) {
      try {
        const r = await fetch(`https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?${sp}`,
          { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(40000) })
        if (r.status === 204 || r.status === 404) return { lista: out, parcial: false }
        if (r.ok) j = await r.json()
        else await sleep(3000 * (t + 1))
      } catch { await sleep(3000 * (t + 1)) }
      if (t === 3 && !j) parcial = true
    }
    if (!j) return { lista: out, parcial: true }
    const lista = j.data ?? []
    out.push(...lista)
    if (lista.length < 50 || pagina >= (j.totalPaginas ?? 1)) return { lista: out, parcial }
    await sleep(DELAY)
  }
  // Estourou o teto de páginas: o que veio é chão, não total.
  return { lista: out, parcial: true }
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

console.log(`sonda · ${DATAS.length} data(s) · UFs ${UFS.join(',')} · modalidades ${MODS.join(',')}`)
console.log('data          uf/mod   PNCP  saúde  na base  faltam    %')

let gSaude = 0
let gBase = 0
let houveParcial = false
const porData = []

for (const dia of DATAS) {
  let dSaude = 0
  let dBase = 0
  for (const uf of UFS) {
    for (const mod of MODS) {
      const { lista, parcial } = await doPncp(dia, uf, mod)
      if (parcial) houveParcial = true
      const saude = lista.filter((x) => isSaude(x.objetoCompra ?? '', x.orgaoEntidade?.razaoSocial ?? ''))
      const ids = saude.map((x) => x.numeroControlePNCP).filter(Boolean)
      let naBase = 0
      if (ids.length) {
        const { rows } = await c.query(
          'SELECT count(*)::int n FROM contratacoes WHERE numero_controle_pncp = ANY($1)', [ids])
        naBase = rows[0].n
      }
      const falta = saude.length - naBase
      const pct = saude.length ? Math.round((falta / saude.length) * 100) : 0
      console.log(`${dia}  ${uf}/${String(mod).padEnd(3)}  ${String(lista.length).padStart(5)}`
        + `  ${String(saude.length).padStart(5)}  ${String(naBase).padStart(7)}  ${String(falta).padStart(6)}`
        + `  ${String(pct).padStart(3)}%${parcial ? '  (parcial)' : ''}`)
      dSaude += saude.length; dBase += naBase
      gSaude += saude.length; gBase += naBase
      await sleep(DELAY)
    }
  }
  porData.push({ dia, saude: dSaude, naBase: dBase })
}

console.log('\npor data:')
for (const d of porData) {
  const falta = d.saude - d.naBase
  const pct = d.saude ? Math.round((falta / d.saude) * 100) : 0
  const barra = '█'.repeat(Math.round(pct / 5)) || '·'
  console.log(`  ${d.dia}  ${String(falta).padStart(4)} de ${String(d.saude).padStart(4)}  ${String(pct).padStart(3)}%  ${barra}`)
}

const falta = gSaude - gBase
const pct = gSaude ? Math.round((falta / gSaude) * 100) : 0
console.log(`\nTOTAL: faltam ${falta} de ${gSaude} (${pct}%)`)
if (houveParcial) {
  console.log('ATENÇÃO: alguma consulta veio PARCIAL (falha ou teto de páginas).')
  console.log('         O total do PNCP é chão, não teto — o que falta pode ser MAIOR.')
}
console.log(pct >= 10
  ? '\nVEREDITO: buraco relevante. Amostre outra UF antes de extrapolar (SP costuma ser o pior caso).'
  : '\nVEREDITO: cobertura boa nesta amostra. Não vale um mutirão só por isto.')
await c.end()
