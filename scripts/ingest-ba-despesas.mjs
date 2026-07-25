// scripts/ingest-ba-despesas.mjs — Item 3 (parte A): DEMANDA de saúde por órgão/ano.
// Fonte: dataset "despesas" (view VW_PAINEL_DESPESA ~2,24GB), filtrada à função Saúde e
// anos recentes, agregada por (ano, órgão) → despesa_saude_agg. Sinal de para onde a
// verba de saúde do estado está indo (demanda). Streaming (memória constante).
//
// Uso: npm run ba:despesas   (ETL_ANOS_MIN=2023 p/ ajustar a janela)

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ckanRecursoZip, baixar, extrairEntradas, processarCsv, parseBR, normKey, novoPg, TMP } from './lib/estados-ckan.mjs'

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const CKAN = 'https://dados.ba.gov.br/api/3/action'
const UF = 'BA'
const ANO_MIN = Number(process.env.ETL_ANOS_MIN ?? 2023)
const ts = () => new Date().toLocaleString('pt-BR')
const col = (o, re) => Object.keys(o).find((k) => re.test(k))
const RE_SAUDE = /sa[úu]de/i

console.log(`[ba:despesas] início ${ts()} — função Saúde, anos >= ${ANO_MIN}`)
const rec = await ckanRecursoZip(CKAN, 'despesas', /despesa/i)
console.log('→ baixando/validando', rec.name, `(${(Number(rec.size) / 1048576).toFixed(0)}MB)…`)
const zip = await baixar(rec.url, path.join(TMP, 'ba-despesas.zip'))
console.log('→ extraindo VW_PAINEL_DESPESA (~2,24GB)…')
const dir = path.join(TMP, 'ba-despesas')
const arqs = extrairEntradas(zip, [/VW_PAINEL_DESPESA/], dir)
const csv = arqs.find((f) => /VW_PAINEL_DESPESA/i.test(f))
if (!csv) { console.error('view de despesa não extraída'); process.exit(1) }

console.log('→ agregando saúde por (ano, órgão)…')
const mapa = new Map() // `${ano}|${orgKey}` → { ano, orgKey, nome, emp, liq, pago, qtd }
let c = null, lidas = 0, saude = 0
await processarCsv(csv, (o) => {
  if (!c) c = {
    ano: col(o, /ano_exercicio/i), org: col(o, /nom_orgao_orcamento/i),
    func: col(o, /nom_funcao_programa/i), sub: col(o, /nom_sub_funcao_programa/i),
    emp: col(o, /val_empenhado_total/i), liq: col(o, /val_liquidado_total/i), pago: col(o, /^val_pago$/i) || col(o, /val_pago/i),
  }
  lidas++
  const ano = Number(o[c.ano])
  if (!ano || ano < ANO_MIN) return
  const func = o[c.func] || '', sub = o[c.sub] || '', org = (o[c.org] || '').trim()
  if (!(RE_SAUDE.test(func) || RE_SAUDE.test(sub) || RE_SAUDE.test(org))) return
  saude++
  const key = `${ano}|${normKey(org)}`
  const g = mapa.get(key) || { ano, orgKey: normKey(org), nome: org, emp: 0, liq: 0, pago: 0, qtd: 0 }
  g.emp += parseBR(o[c.emp]); g.liq += parseBR(o[c.liq]); g.pago += parseBR(o[c.pago]); g.qtd++
  mapa.set(key, g)
})
console.log(`   ${lidas} linhas lidas; ${saude} de saúde; ${mapa.size} agregados (ano×órgão)`)

const db = novoPg(pg)
try {
  await db.query("DELETE FROM despesa_saude_agg WHERE uf = $1 AND favorecido_key = ''", [UF])
  const linhas = [...mapa.values()]
  const CH = 300
  for (let i = 0; i < linhas.length; i += CH) {
    const bloco = linhas.slice(i, i + CH)
    const vals = []
    const ph = bloco.map((g, k) => {
      const b = k * 8
      vals.push(UF, g.ano, g.orgKey, g.nome, g.emp, g.liq, g.pago, g.qtd)
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},'','',NULL,$${b + 5},$${b + 6},$${b + 7},$${b + 8})`
    }).join(',')
    await db.query(
      `INSERT INTO despesa_saude_agg (uf,ano,orgao_key,orgao_nome,favorecido_key,favorecido_nome,favorecido_doc,empenhado,liquidado,pago,qtd)
       VALUES ${ph}
       ON CONFLICT (uf,ano,orgao_key,favorecido_key) DO UPDATE SET orgao_nome=EXCLUDED.orgao_nome,
         empenhado=EXCLUDED.empenhado,liquidado=EXCLUDED.liquidado,pago=EXCLUDED.pago,qtd=EXCLUDED.qtd,atualizado_em=now()`,
      vals,
    )
  }
  console.log(`✓ [ba:despesas] ${linhas.length} agregados de saúde gravados em ${ts()}`)
} finally { await db.end() }
