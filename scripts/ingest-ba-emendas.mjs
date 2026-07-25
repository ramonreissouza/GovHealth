// scripts/ingest-ba-emendas.mjs — Item 2: emendas parlamentares ESTADUAIS da Bahia
// (novo lead no Radar de Verba; o federal já vem do Portal da Transparência).
// Fonte: CKAN dados.ba.gov.br, dataset "emendas-parlamentares", view DESPESAS
// (por emenda/ação: órgão, deputado, empenhado/liquidado/pago). Idempotente (substitui BA).
//
// Uso: npm run ba:emendas

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ckanRecursoZip, baixar, expandir, csvsEm, processarCsv, parseBR, normKey, novoPg, TMP } from './lib/estados-ckan.mjs'

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const CKAN = 'https://dados.ba.gov.br/api/3/action'
const UF = 'BA'
const ts = () => new Date().toLocaleString('pt-BR')

// Sinal de saúde: órgão SESAB, ou saúde/hospital/UPA/UBS/SAMU/médico/farmácia/etc.
const RE_SAUDE = /sa[úu]de|hospital|\bupa\b|\bubs\b|\bsamu\b|m[ée]dic|farmac|medicament|ambul[âa]nc|enfermag|odontol|vacina|cl[íi]nic|laborat[óo]ri/i
function ehSaude(sgl, orgao, acao, unidade) {
  if ((sgl || '').trim().toUpperCase() === 'SESAB') return true
  return RE_SAUDE.test(`${orgao} ${acao} ${unidade}`)
}

// localiza índice de coluna por regex no header
function coluna(obj, re) { return Object.keys(obj).find((k) => re.test(k)) }

console.log(`[ba:emendas] início ${ts()}`)
const rec = await ckanRecursoZip(CKAN, 'emendas-parlamentares', /emenda/i)
if (!rec) { console.error('recurso ZIP de emendas não encontrado'); process.exit(1) }
console.log('→ baixando', rec.name, '…')
const zip = await baixar(rec.url, path.join(TMP, 'ba-emendas.zip'))
const dir = expandir(zip, path.join(TMP, 'ba-emendas'))
const csv = csvsEm(dir).find((f) => /DESPESAS/i.test(f))
if (!csv) { console.error('CSV DESPESAS não encontrado no ZIP'); process.exit(1) }
console.log('→ processando', path.basename(csv))

// Agrega por num_codigo (soma valores; guarda textos).
const mapa = new Map()
let cols = null
await processarCsv(csv, (o) => {
  if (!cols) {
    cols = {
      ano: coluna(o, /ano/i), orgao: coluna(o, /^[oó]rg[ãa]o$/i), sgl: coluna(o, /sgl_orgao/i),
      unidade: coluna(o, /unidade or[çc]ament/i), acao: coluna(o, /a[çc][ãa]o do programa/i),
      autor: coluna(o, /nome do deputado/i) || coluna(o, /deputado/i), num: coluna(o, /num_codigo/i),
      emp: coluna(o, /empenhad/i), liq: coluna(o, /liquidad/i), pago: coluna(o, /pago/i),
    }
  }
  const num = (o[cols.num] || '').trim()
  if (!num) return
  const g = mapa.get(num) || {
    num, ano: Number(o[cols.ano]) || null, orgao: (o[cols.orgao] || '').trim(), sgl: (o[cols.sgl] || '').trim(),
    unidade: (o[cols.unidade] || '').trim(), acao: (o[cols.acao] || '').trim(), autor: (o[cols.autor] || '').trim(),
    emp: 0, liq: 0, pago: 0,
  }
  g.emp += parseBR(o[cols.emp]); g.liq += parseBR(o[cols.liq]); g.pago += parseBR(o[cols.pago])
  mapa.set(num, g)
})

const linhas = [...mapa.values()]
const saude = linhas.filter((g) => ehSaude(g.sgl, g.orgao, g.acao, g.unidade))
console.log(`→ ${linhas.length} emendas/ações no total; ${saude.length} de saúde`)

// Substitui BA (idempotente) e insere as de saúde em lote.
const db = novoPg(pg)
try {
  await db.query('DELETE FROM emendas_estaduais WHERE uf = $1', [UF])
  const CH = 400
  let n = 0
  for (let i = 0; i < saude.length; i += CH) {
    const bloco = saude.slice(i, i + CH)
    const vals = []
    const ph = bloco.map((g, k) => {
      const b = k * 11
      vals.push(UF, g.num, g.ano, g.orgao, g.sgl, g.unidade, g.acao, g.autor, g.emp, g.liq, g.pago)
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},true)`
    }).join(',')
    await db.query(
      `INSERT INTO emendas_estaduais (uf,num_codigo,ano,orgao,sgl_orgao,unidade,acao,autor,empenhado,liquidado,pago,categoria_saude)
       VALUES ${ph}
       ON CONFLICT (uf,num_codigo) DO UPDATE SET ano=EXCLUDED.ano,orgao=EXCLUDED.orgao,sgl_orgao=EXCLUDED.sgl_orgao,
         unidade=EXCLUDED.unidade,acao=EXCLUDED.acao,autor=EXCLUDED.autor,empenhado=EXCLUDED.empenhado,
         liquidado=EXCLUDED.liquidado,pago=EXCLUDED.pago,categoria_saude=true,coletado_em=now()`,
      vals,
    )
    n += bloco.length
  }
  console.log(`✓ [ba:emendas] ${n} emendas de saúde gravadas em ${ts()}`)
} finally { await db.end() }
