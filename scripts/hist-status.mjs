// scripts/hist-status.mjs — RETRATO da cobertura histórica (read-only, comparável).
//
// Serve para responder "avançou quanto desde a última vez?". Além de imprimir, grava
// um snapshot em .hist-status.json; nas execuções seguintes o script mostra o DELTA
// contra esse snapshot — é isso que torna a comparação possível sem depender de
// memória ou de rolar log antigo.
//
// Uso:  npm run hist:status            (imprime + compara com o último snapshot)
//       npm run hist:status -- --salvar  (também sobrescreve o snapshot base)

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
}
const SALVAR = process.argv.includes('--salvar')
const ARQ = '.hist-status.json'

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p) => (await c.query(s, p)).rows

// Cobertura por mês de PUBLICAÇÃO — é o eixo que as telas usam.
const meses = await q(`
  SELECT to_char(data_publicacao,'YYYY-MM') mes,
         count(*)::int contratacoes,
         count(DISTINCT uf)::int ufs,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM itens i WHERE i.numero_controle_pncp = c.numero_controle_pncp))::int com_itens,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM resultados r WHERE r.numero_controle_pncp = c.numero_controle_pncp))::int com_resultados
    FROM contratacoes c
   WHERE data_publicacao >= '2024-12-01' AND data_publicacao < '2026-09-01'
   GROUP BY 1 ORDER BY 1 DESC`)

const [tot] = await q(`SELECT count(*)::int contratacoes, (SELECT count(*)::int FROM itens) itens,
  (SELECT count(*)::int FROM resultados) resultados, count(DISTINCT uf)::int ufs FROM contratacoes`)

const porUf = await q(`
  SELECT uf, count(*)::int n,
         count(*) FILTER (WHERE data_publicacao >= '2025-01-01')::int desde_2025
    FROM contratacoes WHERE uf IS NOT NULL GROUP BY uf ORDER BY 2 DESC`)

// Progresso do coletor histórico: cada chave hist:* é um recorte já iniciado.
const [cp] = await q(`
  SELECT count(*)::int recortes, sum(ultima_pagina)::int paginas, max(atualizado_em) ultimo
    FROM etl_checkpoint WHERE chave LIKE 'hist:%'`)

const agora = new Date()
const anterior = fs.existsSync(ARQ) ? JSON.parse(fs.readFileSync(ARQ, 'utf8')) : null
const snapshot = {
  em: agora.toISOString(),
  totais: tot,
  meses: Object.fromEntries(meses.map((m) => [m.mes, m.contratacoes])),
  recortes: cp.recortes ?? 0,
  paginas: cp.paginas ?? 0,
}

const d = (atual, ant) => {
  if (ant == null) return ''
  const x = atual - ant
  return x === 0 ? '        =' : `  ${x > 0 ? '+' : ''}${x.toLocaleString('pt-BR')}`
}

console.log(`\n═══ COBERTURA HISTÓRICA — ${agora.toLocaleString('pt-BR')} ═══`)
if (anterior) {
  const h = (new Date(agora) - new Date(anterior.em)) / 3600000
  console.log(`(delta contra o snapshot de ${new Date(anterior.em).toLocaleString('pt-BR')} — ${h.toFixed(1)}h atrás)`)
} else {
  console.log('(primeiro snapshot — as próximas execuções mostrarão o delta)')
}

console.log(`\nTOTAIS   contratações ${tot.contratacoes.toLocaleString('pt-BR')}${d(tot.contratacoes, anterior?.totais?.contratacoes)}`)
console.log(`         itens        ${tot.itens.toLocaleString('pt-BR')}${d(tot.itens, anterior?.totais?.itens)}`)
console.log(`         resultados   ${tot.resultados.toLocaleString('pt-BR')}${d(tot.resultados, anterior?.totais?.resultados)}`)
console.log(`         UFs          ${tot.ufs}/27`)
console.log(`COLETOR  recortes iniciados ${snapshot.recortes}${d(snapshot.recortes, anterior?.recortes)} · páginas ${snapshot.paginas}${d(snapshot.paginas, anterior?.paginas)}`)
if (cp.ultimo) console.log(`         última atividade: ${new Date(cp.ultimo).toLocaleString('pt-BR')}`)

console.log('\nPOR MÊS DE PUBLICAÇÃO (alvo: 2026-08 → 2025-01)')
console.log('mês        contratações      Δ   UFs   c/ itens  c/ result.')
console.log('──────────────────────────────────────────────────────────')
for (const m of meses) {
  const delta = anterior?.meses?.[m.mes] != null ? d(m.contratacoes, anterior.meses[m.mes]).trim().padStart(7) : '      —'
  const alvo = m.mes >= '2025-01' ? '' : '  (fora do alvo)'
  console.log(`${m.mes}  ${String(m.contratacoes).padStart(11)}  ${delta}  ${String(m.ufs).padStart(4)}  ${String(m.com_itens).padStart(9)}  ${String(m.com_resultados).padStart(9)}${alvo}`)
}

const buracos = meses.filter((m) => m.mes >= '2025-01' && m.contratacoes < 3000)
if (buracos.length) {
  console.log(`\nMESES AINDA RASOS (<3.000) no alvo: ${buracos.map((b) => `${b.mes}(${b.contratacoes})`).join(' ')}`)
}

console.log('\nPOR UF (n · desde 2025-01)')
console.log(porUf.map((u) => `${u.uf}:${u.n}/${u.desde_2025}`).join('  '))

if (SALVAR || !anterior) {
  fs.writeFileSync(ARQ, JSON.stringify(snapshot, null, 2))
  console.log(`\n→ snapshot salvo em ${ARQ} (base para a próxima comparação)`)
} else {
  console.log(`\n(snapshot base mantido; use "npm run hist:status -- --salvar" para redefinir a base)`)
}
await c.end()
