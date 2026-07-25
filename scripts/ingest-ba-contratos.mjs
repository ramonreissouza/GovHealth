// scripts/ingest-ba-contratos.mjs — Item 3 (parte B): CONTRATOS de saúde da Bahia.
// Fonte: dataset "contratos", view VW_INSTRUMENTO_DESPESA (~725MB): nº, vigência
// (início/fim), objeto, situação, órgão, fornecedor + CNPJ, valores. Filtra saúde e
// contratos relevantes (vigentes ou com fim recente/futuro → oportunidade de renovação
// e inteligência de concorrência). Grava em contrato_estadual. Streaming.
//
// Uso: npm run ba:contratos

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ckanRecursoZip, baixar, extrairEntradas, processarCsv, parseBR, novoPg, TMP } from './lib/estados-ckan.mjs'

if (!process.env.DATABASE_URL) {
  try { const env = fs.readFileSync('.env.local', 'utf8'); const m = env.match(/^DATABASE_URL=(.*)$/m); if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '') } catch {}
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const CKAN = 'https://dados.ba.gov.br/api/3/action'
const UF = 'BA'
const ts = () => new Date().toLocaleString('pt-BR')
const col = (o, re) => Object.keys(o).find((k) => re.test(k))
const RE_SAUDE = /sa[úu]de|hospital|\bupa\b|\bubs\b|\bsamu\b|m[ée]dic|farmac|medicament|ambul[âa]nc|enfermag|odontol|hospitalar|laborat[óo]ri|cl[íi]nic|sanit[áa]ri/i
const parseDataBR = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
// Só contratos com fim de vigência a partir de ~1 ano atrás (relevantes p/ renovação).
const corte = new Date(); corte.setFullYear(corte.getFullYear() - 1)

console.log(`[ba:contratos] início ${ts()}`)
const rec = await ckanRecursoZip(CKAN, 'contratos', /contrato/i)
console.log('→ baixando/validando', rec.name, `(${(Number(rec.size) / 1048576).toFixed(0)}MB)…`)
const zip = await baixar(rec.url, path.join(TMP, 'ba-contratos.zip'))
console.log('→ extraindo VW_INSTRUMENTO_DESPESA (~725MB)…')
const dir = path.join(TMP, 'ba-contratos')
const arqs = extrairEntradas(zip, [/VW_INSTRUMENTO_DESPESA/], dir)
const csv = arqs.find((f) => /VW_INSTRUMENTO_DESPESA/i.test(f))
if (!csv) { console.error('view de instrumento não extraída'); process.exit(1) }

console.log('→ filtrando contratos de saúde relevantes…')
const mapa = new Map() // numero → linha
let c = null, lidas = 0, saude = 0
await processarCsv(csv, (o) => {
  if (!c) c = {
    num: col(o, /num_instrumento_formatado/i), org: col(o, /nom_orgao_orcamento/i),
    forn: col(o, /nom_razao_social/i), doc: col(o, /cnpj_cpf.*formatado/i) || col(o, /cnpj_cpf/i),
    obj: col(o, /des_objeto/i), tipo: col(o, /nom_tipo_despesa/i), sit: col(o, /nom_situacao_instrumento/i),
    ini: col(o, /dtc_inicio_vigencia/i), fim: col(o, /dtc_atual_fim_vigencia/i), val: col(o, /val_inst_atual/i) || col(o, /val_inst/i),
  }
  lidas++
  const org = (o[c.org] || '').trim(), obj = (o[c.obj] || '').trim(), tipo = (o[c.tipo] || '').trim()
  if (!(RE_SAUDE.test(org) || RE_SAUDE.test(obj) || RE_SAUDE.test(tipo))) return
  const fim = parseDataBR(o[c.fim])
  if (!fim || new Date(fim) < corte) return // fora da janela de relevância
  saude++
  const numero = (o[c.num] || '').trim()
  if (!numero) return
  mapa.set(numero, {
    numero, orgao: org, fornecedor: (o[c.forn] || '').trim(), doc: (o[c.doc] || '').trim(),
    objeto: obj.slice(0, 500), valor: parseBR(o[c.val]), inicio: parseDataBR(o[c.ini]), fim,
  })
})
console.log(`   ${lidas} instrumentos lidos; ${saude} de saúde relevantes; ${mapa.size} contratos únicos`)

const db = novoPg(pg)
try {
  await db.query('DELETE FROM contrato_estadual WHERE uf = $1', [UF])
  const linhas = [...mapa.values()]
  const CH = 300
  for (let i = 0; i < linhas.length; i += CH) {
    const bloco = linhas.slice(i, i + CH)
    const vals = []
    const ph = bloco.map((g, k) => {
      const b = k * 9
      vals.push(UF, g.numero, g.orgao, g.fornecedor, g.doc, g.objeto, g.valor, g.inicio, g.fim)
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},true)`
    }).join(',')
    await db.query(
      `INSERT INTO contrato_estadual (uf,numero,orgao,fornecedor_nome,fornecedor_doc,objeto,valor,data_inicio,data_fim,categoria_saude)
       VALUES ${ph}
       ON CONFLICT (uf,numero) DO UPDATE SET orgao=EXCLUDED.orgao,fornecedor_nome=EXCLUDED.fornecedor_nome,
         fornecedor_doc=EXCLUDED.fornecedor_doc,objeto=EXCLUDED.objeto,valor=EXCLUDED.valor,
         data_inicio=EXCLUDED.data_inicio,data_fim=EXCLUDED.data_fim,categoria_saude=true,coletado_em=now()`,
      vals,
    )
  }
  console.log(`✓ [ba:contratos] ${linhas.length} contratos de saúde gravados em ${ts()}`)
} finally { await db.end() }
