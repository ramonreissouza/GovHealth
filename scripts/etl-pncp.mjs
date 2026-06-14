// scripts/etl-pncp.mjs — ETL de resultados homologados do PNCP → Postgres (Neon).
//
// Fluxo: contratações de saúde → itens → resultados (vencedores).
// Endpoints confirmados ao vivo:
//   itens:      /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens
//   resultados: /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens/{numeroItem}/resultados
//
// Uso (piloto): node scripts/etl-pncp.mjs --uf=CE --meses=3 --modalidades=6,8 --max=80
// Idempotente (UPSERT): pode reexecutar sem duplicar.

import fs from 'node:fs'
import pg from 'pg'

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* noop */ }
}
loadEnv()
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const UF = (args.uf ?? 'CE').toUpperCase()
const MESES = Number(args.meses ?? 3)
const MODALIDADES = String(args.modalidades ?? '6,8').split(',').map(Number)
const MAX_CONTRATACOES = Number(args.max ?? 80)
const DELAY = Number(args.delay ?? 400)

const CONSULTA = 'https://pncp.gov.br/api/consulta/v1'
const PNCP = 'https://pncp.gov.br/api/pncp/v1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

const hoje = new Date()
const inicio = new Date(hoje); inicio.setMonth(hoje.getMonth() - MESES)
const dataInicial = yyyymmdd(inicio)
const dataFinal = yyyymmdd(hoje)

const HEALTH = ['saude','saúde','hospital','médic','medic','equip','uti','laborat','cirurg','tomógrafo','ressonância','ultrassom','monitor','ventilador','respirador','medicament','farmac','enfermagem','clínic','ambulânc','odontológ','oncolog','raio','cateter','seringa','luva']
const isSaude = (s) => { const l = (s ?? '').toLowerCase(); return HEALTH.some((k) => l.includes(k)) }
function categoria(s) {
  const l = (s ?? '').toLowerCase()
  if (/tom[óo]grafo|tomografia|resson|ultrassom|raio|mam[óo]graf|radiolog/.test(l)) return 'imagem'
  if (/uti|ventilador|respirador|monitor|desfibrilador|oxímetro/.test(l)) return 'uti'
  if (/laborat|analisador|hematolog|reagente/.test(l)) return 'laboratorio'
  if (/cirurg|bisturi|mesa cir/.test(l)) return 'cirurgia'
  if (/oncolog|quimioter|radioter/.test(l)) return 'oncologia'
  if (/medicament|fármaco|farmac|vacina|soro|injetável/.test(l)) return 'medicamento'
  return 'outros'
}

async function fetchJson(url, tentativa = 0) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.status === 429 && tentativa < 4) { await sleep(2000 * (tentativa + 1)); return fetchJson(url, tentativa + 1) }
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

// ── DB ───────────────────────────────────────────────────────────────────────
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

async function upsertContratacao(c) {
  await db.query(
    `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
       modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
       data_publicacao, situacao_id, categoria_saude)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       valor_total_estimado = EXCLUDED.valor_total_estimado,
       situacao_id = EXCLUDED.situacao_id,
       categoria_saude = EXCLUDED.categoria_saude`,
    [c.numeroControlePNCP, c.orgaoEntidade?.cnpj ?? '', c.orgaoEntidade?.razaoSocial ?? null,
     c.unidadeOrgao?.municipioNome ?? null, c.unidadeOrgao?.ufSigla ?? UF, c.modalidadeNome ?? null,
     c.objetoCompra ?? null, c.anoCompra ?? null, c.sequencialCompra ?? null, c.valorTotalEstimado ?? null,
     (c.dataPublicacaoPncp ?? '').slice(0, 10) || null, c.situacaoCompraId ?? null, categoria(c.objetoCompra)],
  )
}

async function upsertItem(numeroControle, it) {
  await db.query(
    `INSERT INTO itens (numero_controle_pncp, numero_item, descricao, codigo_catmat, nome_catmat,
       quantidade, valor_unitario_estimado, situacao_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (numero_controle_pncp, numero_item) DO UPDATE SET
       situacao_item_id = EXCLUDED.situacao_item_id`,
    [numeroControle, it.numeroItem, it.descricao ?? null, it.catalogoCodigoItem ?? null,
     it.descricao ?? null, it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.situacaoCompraItem ?? null],
  )
}

async function upsertResultado(c, it, r) {
  if (!r.niFornecedor) return
  await db.query(
    `INSERT INTO resultados (numero_controle_pncp, numero_item, ni_fornecedor, nome_fornecedor,
       quantidade_homologada, valor_unitario_homologado, valor_total_homologado, data_resultado,
       ordem_classificacao_srp, porte_fornecedor, uf, codigo_catmat, nome_catmat, ano)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (numero_controle_pncp, numero_item, ni_fornecedor) DO UPDATE SET
       valor_total_homologado = EXCLUDED.valor_total_homologado,
       nome_fornecedor = EXCLUDED.nome_fornecedor`,
    [c.numeroControlePNCP, it.numeroItem, r.niFornecedor, r.nomeRazaoSocialFornecedor ?? null,
     r.quantidadeHomologada ?? null, r.valorUnitarioHomologado ?? null, r.valorTotalHomologado ?? null,
     (r.dataResultado ?? r.dataInclusao ?? '').slice(0, 10) || null, r.ordemClassificacaoSrp ?? null,
     r.porteFornecedorNome ?? null, c.unidadeOrgao?.ufSigla ?? UF, it.catalogoCodigoItem ?? null,
     it.descricao ?? null, c.anoCompra ?? null],
  )
}

// ── pipeline ─────────────────────────────────────────────────────────────────
let nContrat = 0, nItens = 0, nResult = 0
console.log(`[ETL] UF=${UF} janela=${dataInicial}→${dataFinal} modalidades=${MODALIDADES} max=${MAX_CONTRATACOES}`)

outer:
for (const mod of MODALIDADES) {
  for (let pagina = 1; pagina <= 50; pagina++) {
    const sp = new URLSearchParams({ dataInicial, dataFinal, codigoModalidadeContratacao: String(mod), uf: UF, pagina: String(pagina), tamanhoPagina: '50' })
    const resp = await fetchJson(`${CONSULTA}/contratacoes/publicacao?${sp}`)
    const lista = (resp?.data ?? []).filter((c) => isSaude(c.objetoCompra))
    if (!resp || (resp.data ?? []).length === 0) break

    for (const c of lista) {
      if (nContrat >= MAX_CONTRATACOES) break outer
      await upsertContratacao(c); nContrat++

      const itensResp = await fetchJson(`${PNCP}/orgaos/${c.orgaoEntidade?.cnpj}/compras/${c.anoCompra}/${c.sequencialCompra}/itens?pagina=1&tamanhoPagina=100`)
      await sleep(DELAY)
      const itens = Array.isArray(itensResp) ? itensResp : (itensResp?.data ?? [])
      for (const it of itens) {
        await upsertItem(c.numeroControlePNCP, it); nItens++
        if (it.temResultado || it.situacaoCompraItem === 2) {
          const resArr = await fetchJson(`${PNCP}/orgaos/${c.orgaoEntidade?.cnpj}/compras/${c.anoCompra}/${c.sequencialCompra}/itens/${it.numeroItem}/resultados?pagina=1&tamanhoPagina=20`)
          await sleep(DELAY)
          for (const r of (Array.isArray(resArr) ? resArr : (resArr?.data ?? []))) {
            await upsertResultado(c, it, r); nResult++
          }
        }
      }
      console.log(`  ✓ ${c.numeroControlePNCP} (${itens.length} itens) — acum: ${nContrat}c / ${nItens}i / ${nResult}r`)
    }
    if ((resp.data ?? []).length < 50 || pagina >= (resp.totalPaginas ?? 1)) break
  }
}

await db.query(`INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1,$2)
  ON CONFLICT (chave) DO UPDATE SET atualizado_em = now()`, [`uf:${UF}`, 0])
console.log(`\n[ETL] concluído: ${nContrat} contratações · ${nItens} itens · ${nResult} resultados homologados`)
await db.end()
