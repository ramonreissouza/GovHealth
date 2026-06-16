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
const UF_LIST = String(args.uf ?? 'CE').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean)
let UF = UF_LIST[0] // UF corrente (usada na desnormalização); reatribuída por iteração
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

// Retorna o JSON, ou null SÓ quando o servidor responde 404 (recurso inexistente).
// Erros transitórios (rede, timeout, 429, 5xx) são retentados com backoff; se
// esgotarem as tentativas, lança — o chamador decide se aborta ou tolera.
async function fetchJson(url, tentativa = 0) {
  const MAX = 5
  try {
    // PNCP às vezes deixa a conexão pendurada sem responder; sem timeout o fetch
    // trava pra sempre e congela o ETL. AbortSignal.timeout aborta → vira retry.
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    if (res.status === 404) return null
    if ((res.status === 429 || res.status >= 500) && tentativa < MAX) {
      console.warn(`  [rate-limit] HTTP ${res.status} — retry ${tentativa + 1}/${MAX} em ${2 * (tentativa + 1)}s`)
      await sleep(2000 * (tentativa + 1)); return fetchJson(url, tentativa + 1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    if (tentativa < MAX) { await sleep(2000 * (tentativa + 1)); return fetchJson(url, tentativa + 1) }
    throw new Error(`falha após ${MAX} tentativas em ${url}: ${e.message}`)
  }
}
// Variante tolerante: usada em chamadas onde um null transitório só perde 1 item.
async function fetchJsonSafe(url) { try { return await fetchJson(url) } catch { return null } }
// Canário barato (1 tentativa, timeout curto): a página 1 daquela UF/modalidade
// responde? Serve para distinguir outage global do PNCP de página profunda quebrada.
async function pncpVivo(mod, uf) {
  try {
    const sp = new URLSearchParams({ dataInicial, dataFinal, codigoModalidadeContratacao: String(mod), uf, pagina: '1', tamanhoPagina: '1' })
    const res = await fetch(`${CONSULTA}/contratacoes/publicacao?${sp}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    return res.ok
  } catch { return false }
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

// ── checkpoint / resumo ──────────────────────────────────────────────────────
async function jaProcessada(num) {
  const r = await db.query('SELECT 1 FROM itens WHERE numero_controle_pncp = $1 LIMIT 1', [num])
  return r.rowCount > 0
}
async function lerCheckpoint(chave) {
  const r = await db.query('SELECT ultima_pagina FROM etl_checkpoint WHERE chave = $1', [chave])
  return r.rows[0]?.ultima_pagina ?? 0
}
async function salvarCheckpoint(chave, pagina) {
  await db.query(`INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1,$2)
    ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`, [chave, pagina])
}

// ── pipeline ─────────────────────────────────────────────────────────────────
let totC = 0, totI = 0, totR = 0, totSkip = 0
console.log(`[ETL] UFs=${UF_LIST.join(',')} janela=${dataInicial}→${dataFinal} modalidades=${MODALIDADES} max/UF=${MAX_CONTRATACOES} delay=${DELAY}ms`)

for (const ufAtual of UF_LIST) {
  UF = ufAtual
  // Cap PERSISTENTE: já contabiliza o que existe no banco p/ esta UF, então a
  // amostra de MAX_CONTRATACOES é por UF "no total" e sobrevive a restarts —
  // uma UF já saturada é pulada na hora em vez de reabrir o orçamento.
  const jaNoBanco = await db.query('SELECT count(*)::int n FROM contratacoes WHERE uf = $1', [UF])
  let nContrat = jaNoBanco.rows[0].n
  if (nContrat >= MAX_CONTRATACOES) { console.log(`\n── UF ${UF} ── já saturada (${nContrat} ≥ ${MAX_CONTRATACOES}) — pulando`); continue }
  console.log(`\n── UF ${UF} ── (${nContrat} já no banco)`)

  for (const mod of MODALIDADES) {
    const chave = `uf:${UF}:mod:${mod}`
    let pagina = (await lerCheckpoint(chave)) + 1
    if (pagina > 1) console.log(`  retomando ${UF}/mod${mod} da página ${pagina}`)

    let falhasSeguidas = 0
    for (; pagina <= 400; pagina++) {
      const sp = new URLSearchParams({ dataInicial, dataFinal, codigoModalidadeContratacao: String(mod), uf: UF, pagina: String(pagina), tamanhoPagina: '50' })
      let resp
      try {
        resp = await fetchJson(`${CONSULTA}/contratacoes/publicacao?${sp}`)
        falhasSeguidas = 0
      } catch (e) {
        // Dois cenários ao falhar uma página de listagem:
        //  (a) OUTAGE global do PNCP (até a página 1 falha): esperar e repetir a
        //      MESMA página, sem avançar o checkpoint — não perde dados e retoma
        //      a coleta quando o PNCP voltar (essencial p/ rodar overnight).
        //  (b) Paginação profunda quebrada (pág 1 responde, mas a atual não):
        //      pular a página; após 3 seguidas, circuit breaker → próxima
        //      modalidade/UF, para não gastar horas em páginas mortas.
        if (!(await pncpVivo(mod, UF))) {
          console.warn(`  [outage] PNCP indisponível (pág 1 também falha) — aguardando 60s e repetindo ${UF}/mod${mod} pág ${pagina}`)
          await sleep(60000)
          pagina-- // repete a MESMA página (o for fará pagina++); checkpoint NÃO avança
          falhasSeguidas = 0
          continue
        }
        falhasSeguidas++
        console.warn(`  [skip] ${UF}/mod${mod} pág ${pagina} falhou (${falhasSeguidas}x seguidas) — ${e.message.slice(0, 40)}`)
        await salvarCheckpoint(chave, pagina)
        if (falhasSeguidas >= 3) { console.warn(`  [circuit-breaker] ${UF}/mod${mod}: ${falhasSeguidas} páginas seguidas falhando (pág 1 ok) — paginação profunda degradada; encerrando modalidade`); break }
        continue
      }
      if (!resp || (resp.data ?? []).length === 0) break
      const lista = resp.data.filter((c) => isSaude(c.objetoCompra))

      let hitMax = false
      for (const c of lista) {
        if (nContrat >= MAX_CONTRATACOES) { hitMax = true; break }
        await upsertContratacao(c); totC++

        // Resumo barato: se a contratação já tem itens no banco, pula chamadas caras.
        // Não conta no cap (nContrat) — assim a retomada avança para as novas.
        if (await jaProcessada(c.numeroControlePNCP)) { totSkip++; continue }
        nContrat++ // só conta contratações efetivamente processadas nesta rodada

        const itensResp = await fetchJsonSafe(`${PNCP}/orgaos/${c.orgaoEntidade?.cnpj}/compras/${c.anoCompra}/${c.sequencialCompra}/itens?pagina=1&tamanhoPagina=100`)
        await sleep(DELAY)
        const itens = Array.isArray(itensResp) ? itensResp : (itensResp?.data ?? [])
        for (const it of itens) {
          await upsertItem(c.numeroControlePNCP, it); totI++
          if (it.temResultado || it.situacaoCompraItem === 2) {
            const resArr = await fetchJsonSafe(`${PNCP}/orgaos/${c.orgaoEntidade?.cnpj}/compras/${c.anoCompra}/${c.sequencialCompra}/itens/${it.numeroItem}/resultados?pagina=1&tamanhoPagina=20`)
            await sleep(DELAY)
            for (const r of (Array.isArray(resArr) ? resArr : (resArr?.data ?? []))) { await upsertResultado(c, it, r); totR++ }
          }
        }
      }

      if (hitMax) { console.log(`  max/UF (${MAX_CONTRATACOES}) atingido em ${UF}`); break }
      await salvarCheckpoint(chave, pagina) // página inteira concluída → checkpoint
      console.log(`  ${UF}/mod${mod} pág ${pagina}: +${lista.length} saúde — acum ${totC}c/${totI}i/${totR}r (skip ${totSkip})`)
      if (resp.data.length < 50 || pagina >= (resp.totalPaginas ?? 1)) break
    }
    if (nContrat >= MAX_CONTRATACOES) break
  }
  console.log(`  ✓ ${UF}: ${nContrat} contratações nesta rodada`)
}

console.log(`\n[ETL] concluído: ${totC} contratações · ${totI} itens · ${totR} resultados · ${totSkip} já processadas (puladas)`)
await db.end()
