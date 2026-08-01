// scripts/etl-fornecedor.mjs — ETL DIRIGIDO POR FORNECEDOR (CNPJ).
//
// Diferente do etl-pncp (varre por UF + filtro de saúde, com teto por UF), este puxa
// o HISTÓRICO REAL E COMPLETO de um fornecedor específico — todos os contratos dele no
// PNCP, de qualquer esfera/UF, sem teto — para que o histórico da conta do cliente
// "bata com a realidade". Serve p/ contas de apresentação (Siemens, Prime Medical…).
//
// Caminho (verificado ao vivo):
//   1) PNCP search  /api/search/?q={cnpj}&tipos_documento=contrato   → contratos do CNPJ
//   2) detalhe do contrato  /api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{seq}
//        → campo numeroControlePncpCompra  = a CONTRATAÇÃO de origem
//   3) enriquece a contratação:  header (consulta/v1) + itens + resultados (pncp/v1)
//        → UPSERT em contratacoes / itens / resultados (mesmas tabelas do etl-pncp)
//
// Idempotente (UPSERT + jaProcessada). Restartável. Uso:
//   node scripts/etl-fornecedor.mjs
//   node scripts/etl-fornecedor.mjs --cnpjs=01449930000351,09342946000100 --delay=300
import fs from 'node:fs'
import pg from 'pg'
import { categoria } from './saude-filter.mjs'

// ── env ──
if (!process.env.DATABASE_URL) {
  const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

// ── args ──
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
// Default: as duas contas de apresentação. Rótulo só p/ log.
const ALVOS = String(args.cnpjs ?? '01449930000351,09342946000100').split(',').map((s) => s.replace(/\D/g, '')).filter((s) => s.length === 14)
const ROTULO = { '01449930000351': 'Siemens', '09342946000100': 'Prime Medical' }
const DELAY = Number(args.delay ?? 300)
const MAX_PAGINAS_BUSCA = Number(args.maxpag ?? 20) // 50/pág → até 1000 contratos por CNPJ
const LIMITE = args.limite ? Number(args.limite) : null // teste: processa só N contratos por CNPJ

const SEARCH = 'https://pncp.gov.br/api/search'
const PNCP = 'https://pncp.gov.br/api/pncp/v1'
const CONSULTA = 'https://pncp.gov.br/api/consulta/v1'
const UA = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; GovHealthAI/1.0)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retorna JSON, ou null em 404/204/301 (recurso ausente/movido tratado no chamador).
// Transitórios (rede/429/5xx) são retentados; esgotando, devolve null (tolerante).
async function fetchJson(url, tent = 0) {
  const MAX = 5
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })
    if (res.status === 404 || res.status === 204 || res.status === 301) return null
    if ((res.status === 429 || res.status >= 500) && tent < MAX) { await sleep(2000 * (tent + 1)); return fetchJson(url, tent + 1) }
    if (!res.ok) return null
    const txt = await res.text()
    return txt ? JSON.parse(txt) : null
  } catch (e) {
    if (tent < MAX) { await sleep(2000 * (tent + 1)); return fetchJson(url, tent + 1) }
    return null
  }
}

// ── DB (recriável, reconecta sob demanda) ──
function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', (e) => console.warn(`  [db] ${e.message} (reconecta)`))
  return c
}
let db = novoDb(); await db.connect()
async function dbQuery(text, params, tent = 0) {
  try { return await db.query(text, params) }
  catch (e) {
    if (tent < 5) { try { await db.end() } catch {} db = novoDb(); try { await db.connect() } catch {} await sleep(1500 * (tent + 1)); return dbQuery(text, params, tent + 1) }
    throw e
  }
}

async function upsertContratacao(c) {
  await dbQuery(
    `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
       modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
       data_publicacao, data_abertura_proposta, data_encerramento_proposta, situacao_id, categoria_saude)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       valor_total_estimado = EXCLUDED.valor_total_estimado,
       data_abertura_proposta = EXCLUDED.data_abertura_proposta,
       data_encerramento_proposta = EXCLUDED.data_encerramento_proposta,
       situacao_id = EXCLUDED.situacao_id,
       categoria_saude = COALESCE(EXCLUDED.categoria_saude, contratacoes.categoria_saude)`,
    [c.numeroControlePNCP, c.orgaoEntidade?.cnpj ?? '', c.orgaoEntidade?.razaoSocial ?? null,
     c.unidadeOrgao?.municipioNome ?? null, c.unidadeOrgao?.ufSigla ?? null, c.modalidadeNome ?? null,
     c.objetoCompra ?? null, c.anoCompra ?? null, c.sequencialCompra ?? null, c.valorTotalEstimado ?? null,
     (c.dataPublicacaoPncp ?? '').slice(0, 10) || null, (c.dataAberturaProposta ?? '').slice(0, 10) || null,
     (c.dataEncerramentoProposta ?? '').slice(0, 10) || null, c.situacaoCompraId ?? null, categoria(c.objetoCompra)])
}
async function upsertItem(num, it) {
  await dbQuery(
    `INSERT INTO itens (numero_controle_pncp, numero_item, descricao, codigo_catmat, nome_catmat, quantidade, valor_unitario_estimado, situacao_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (numero_controle_pncp, numero_item) DO UPDATE SET situacao_item_id = EXCLUDED.situacao_item_id`,
    [num, it.numeroItem, it.descricao ?? null, it.catalogoCodigoItem ?? null, it.descricao ?? null,
     it.quantidade ?? null, it.valorUnitarioEstimado ?? null, it.situacaoCompraItem ?? null])
}
async function upsertResultado(c, it, r) {
  if (!r.niFornecedor) return
  await dbQuery(
    `INSERT INTO resultados (numero_controle_pncp, numero_item, ni_fornecedor, nome_fornecedor,
       quantidade_homologada, valor_unitario_homologado, valor_total_homologado, data_resultado,
       ordem_classificacao_srp, porte_fornecedor, uf, codigo_catmat, nome_catmat, ano)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (numero_controle_pncp, numero_item, ni_fornecedor) DO UPDATE SET
       valor_total_homologado = EXCLUDED.valor_total_homologado, nome_fornecedor = EXCLUDED.nome_fornecedor`,
    [c.numeroControlePNCP, it.numeroItem, r.niFornecedor, r.nomeRazaoSocialFornecedor ?? null,
     r.quantidadeHomologada ?? null, r.valorUnitarioHomologado ?? null, r.valorTotalHomologado ?? null,
     (r.dataResultado ?? r.dataInclusao ?? '').slice(0, 10) || null, r.ordemClassificacaoSrp ?? null,
     r.porteFornecedorNome ?? null, c.unidadeOrgao?.ufSigla ?? null, it.catalogoCodigoItem ?? null, it.descricao ?? null, c.anoCompra ?? null])
}
async function jaTemItens(num) {
  const r = await dbQuery('SELECT 1 FROM itens WHERE numero_controle_pncp=$1 LIMIT 1', [num])
  return r.rowCount > 0
}

// numeroControlePncpCompra: "15126437000143-1-000632/2024" → {orgao, ano, seq}
function parseCompra(nc) {
  const m = String(nc || '').match(/^(\d{14})-\d+-(\d+)\/(\d{4})$/)
  return m ? { orgao: m[1], seq: Number(m[2]), ano: m[3] } : null
}

// 1) todos os contratos do CNPJ (paginado)
async function contratosDoFornecedor(cnpj) {
  const out = []
  for (let p = 1; p <= MAX_PAGINAS_BUSCA; p++) {
    const j = await fetchJson(`${SEARCH}/?q=${cnpj}&tipos_documento=contrato&ordenacao=-data&pagina=${p}&tam_pagina=50`)
    const items = j?.items ?? []
    out.push(...items)
    await sleep(DELAY)
    if (items.length < 50) break
  }
  return out
}

// ── pipeline ──
let totC = 0, totI = 0, totR = 0
for (const cnpj of ALVOS) {
  const nome = ROTULO[cnpj] ?? cnpj
  console.log(`\n===== ${nome} (${cnpj}) =====`)
  let contratos = await contratosDoFornecedor(cnpj)
  if (LIMITE) contratos = contratos.slice(0, LIMITE)
  console.log(`  contratos no PNCP: ${contratos.length}${LIMITE ? ` (limitado a ${LIMITE})` : ''}`)

  // 2) contrato → contratação (numeroControlePncpCompra), deduplicando as contratações
  const comprasVistas = new Set()
  const compras = []
  let iC = 0
  for (const ct of contratos) {
    iC++
    if (!ct.orgao_cnpj || !ct.ano || !ct.numero_sequencial) continue
    const det = await fetchJson(`${PNCP}/orgaos/${ct.orgao_cnpj}/contratos/${ct.ano}/${Number(ct.numero_sequencial)}`)
    await sleep(DELAY)
    const nc = det?.numeroControlePncpCompra
    const parsed = nc && parseCompra(nc)
    if (parsed && !comprasVistas.has(nc)) { comprasVistas.add(nc); compras.push(parsed) }
    if (iC % 25 === 0) console.log(`  … ${iC}/${contratos.length} contratos → ${compras.length} contratações únicas`)
  }
  console.log(`  contratações únicas de origem: ${compras.length}`)

  // 3) enriquecer cada contratação (header + itens + resultados)
  let nEnriq = 0, nSkip = 0
  for (const cmp of compras) {
    const header = await fetchJson(`${CONSULTA}/orgaos/${cmp.orgao}/compras/${cmp.ano}/${cmp.seq}`)
    await sleep(DELAY)
    if (!header || !header.numeroControlePNCP) continue
    await upsertContratacao(header); totC++
    if (await jaTemItens(header.numeroControlePNCP)) { nSkip++; continue }
    const itensResp = await fetchJson(`${PNCP}/orgaos/${cmp.orgao}/compras/${cmp.ano}/${cmp.seq}/itens?pagina=1&tamanhoPagina=100`)
    await sleep(DELAY)
    const itens = Array.isArray(itensResp) ? itensResp : (itensResp?.data ?? [])
    for (const it of itens) {
      await upsertItem(header.numeroControlePNCP, it); totI++
      if (it.temResultado || it.situacaoCompraItem === 2) {
        const resArr = await fetchJson(`${PNCP}/orgaos/${cmp.orgao}/compras/${cmp.ano}/${cmp.seq}/itens/${it.numeroItem}/resultados?pagina=1&tamanhoPagina=20`)
        await sleep(DELAY)
        for (const r of (Array.isArray(resArr) ? resArr : (resArr?.data ?? []))) { await upsertResultado(header, it, r); totR++ }
      }
    }
    nEnriq++
    if (nEnriq % 10 === 0) console.log(`  … enriquecidas ${nEnriq}/${compras.length} (skip ${nSkip}) — acum ${totI}i/${totR}r`)
  }

  // resumo da conta após enriquecer
  const q = await dbQuery(
    `SELECT count(*)::int n, count(distinct numero_controle_pncp)::int lics, coalesce(sum(valor_total_homologado),0)::float8 total
       FROM resultados WHERE regexp_replace(ni_fornecedor,'[^0-9]','','g')=$1`, [cnpj])
  console.log(`  ✓ ${nome}: enriquecidas ${nEnriq} (skip ${nSkip}). Agora no banco: ${q.rows[0].lics} licitações, ${q.rows[0].n} resultados, R$ ${(q.rows[0].total/1e6).toFixed(2)}M`)
}

console.log(`\n[etl-fornecedor] concluído: +${totC} contratações · +${totI} itens · +${totR} resultados`)
await db.end()
