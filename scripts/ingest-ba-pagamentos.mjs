// scripts/ingest-ba-pagamentos.mjs — Item 1 (piloto): COMPORTAMENTO DE PAGAMENTO por
// órgão, da ordem cronológica da Bahia. Junta CONTRATOS (instrumento→órgão) com
// PAGAMENTO_NOTA_ORDEM_BANCARIA (valor + data). Agrega por órgão: valor pago (12m) e
// nº de pagamentos → sinal de atividade/porte de disbursos. (Prazo médio/atraso exato
// exige a view LIQUIDACAO de ~1GB — evolução futura.) Grava em pagamento_comportamento.
//
// Uso: npm run ba:pagamentos

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
const ts = () => new Date().toLocaleString('pt-BR')
const col = (o, re) => Object.keys(o).find((k) => re.test(k))
const parseDataBR = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null }

console.log(`[ba:pagamentos] início ${ts()}`)
const rec = await ckanRecursoZip(CKAN, 'ordem-cronologica-de-pagamentos', /ordem/i)
if (!rec) { console.error('recurso não encontrado'); process.exit(1) }
console.log('→ baixando/validando', rec.name, `(${(Number(rec.size) / 1048576).toFixed(0)}MB)…`)
const zip = await baixar(rec.url, path.join(TMP, 'ba-ordem-cronologica.zip'))
console.log('→ extraindo CONTRATOS + PAGAMENTO…')
const dir = path.join(TMP, 'ba-ordem-cronologica')
const arqs = extrairEntradas(zip, [/CONTRATOS/, /PAGAMENTO_NOTA/], dir)
const csvContratos = arqs.find((f) => /CONTRATOS/i.test(f))
const csvPagto = arqs.find((f) => /PAGAMENTO_NOTA/i.test(f))
if (!csvContratos || !csvPagto) { console.error('CSVs esperados não extraídos:', arqs); process.exit(1) }

// 1) CONTRATOS → mapa instrumento → { órgão, sgl }
console.log('→ mapeando instrumento→órgão (CONTRATOS)…')
const inst2org = new Map()
let cC = null
await processarCsv(csvContratos, (o) => {
  if (!cC) cC = { num: col(o, /num_instrumento/i), org: col(o, /^[oó]rg[ãa]o$/i) || col(o, /^[oó]rg[ãa]o/i), sgl: col(o, /sgl.*[oó]rg/i) }
  const num = (o[cC.num] || '').trim()
  if (num) inst2org.set(num, { orgao: (o[cC.org] || '').trim(), sgl: (o[cC.sgl] || '').trim() })
})
console.log(`   ${inst2org.size} instrumentos mapeados`)

// 2) PAGAMENTO → agrega por órgão (efetivados, últimos 12 meses)
console.log('→ agregando pagamentos por órgão (PAGAMENTO_NOTA)…')
const corte12m = new Date(); corte12m.setMonth(corte12m.getMonth() - 12)
const porOrg = new Map() // orgao_key → { nome, valor12m, qtd12m }
let cP = null, linhas = 0
await processarCsv(csvPagto, (o) => {
  if (!cP) cP = { num: col(o, /num_instrumento/i), val: col(o, /val_pagto/i), data: col(o, /data do pagamento/i), efet: col(o, /pagamento efetivado/i), est: col(o, /estorno pagamento/i) }
  linhas++
  if ((o[cP.efet] || '').trim().toLowerCase() !== 'sim') return
  if ((o[cP.est] || '').trim().toLowerCase() === 'sim') return
  const org = inst2org.get((o[cP.num] || '').trim())
  if (!org || !org.orgao) return
  const d = parseDataBR(o[cP.data])
  if (!d || d < corte12m) return
  const key = normKey(org.orgao)
  const g = porOrg.get(key) || { nome: org.orgao, valor12m: 0, qtd12m: 0 }
  g.valor12m += parseBR(o[cP.val]); g.qtd12m++
  porOrg.set(key, g)
})
console.log(`   ${linhas} linhas de pagamento lidas; ${porOrg.size} órgãos com pagamento nos últimos 12m`)

// 3) Grava (substitui BA)
const db = novoPg(pg)
try {
  await db.query('DELETE FROM pagamento_comportamento WHERE uf = $1', [UF])
  const linhasOrg = [...porOrg.entries()]
  const CH = 300
  for (let i = 0; i < linhasOrg.length; i += CH) {
    const bloco = linhasOrg.slice(i, i + CH)
    const vals = []
    const ph = bloco.map(([key, g], k) => {
      const b = k * 5
      vals.push(UF, key, g.nome, g.valor12m, g.qtd12m)
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`
    }).join(',')
    await db.query(
      `INSERT INTO pagamento_comportamento (uf, orgao_key, orgao_nome, valor_pago_12m, qtd_fila)
       VALUES ${ph}
       ON CONFLICT (uf, orgao_key) DO UPDATE SET orgao_nome=EXCLUDED.orgao_nome,
         valor_pago_12m=EXCLUDED.valor_pago_12m, qtd_fila=EXCLUDED.qtd_fila, atualizado_em=now()`,
      vals,
    )
  }
  console.log(`✓ [ba:pagamentos] ${linhasOrg.length} órgãos gravados em ${ts()}`)
} finally { await db.end() }
