// scripts/etl-enriquecer.mjs — 2a PASSADA: preenche o valor que a coleta não trouxe.
//
// A coleta histórica usa o endpoint de BUSCA do PNCP (/api/search), o único que
// aguenta varrer o país inteiro — mas ele NÃO devolve `valorTotalEstimado`. Ficaram
// 238.036 das 331.177 contratações com valor NULL. Não é que sejam pequenas nem que
// o dado não exista: conferido em amostra, o PNCP tem o valor de todas elas
// (R$ 1,05M, R$ 678k, R$ 758k…). Enquanto falta, a licitação some das telas que
// filtram/ordenam por valor e o ticket médio fica sem base.
//
// POR QUE PELA LISTA E NÃO PELO DETALHE
// O caminho óbvio seria pedir o detalhe de cada uma (/orgaos/{cnpj}/compras/{ano}/{seq}).
// Medido: esse endpoint devolve 429 já a 1 req/s — 238 mil chamadas levariam dias, e
// a rajada ainda derruba o acesso por um tempo. A LISTA
// (/contratacoes/publicacao, 50 por página) não sofre o mesmo limite: 8 páginas
// seguidas a 400 ms passaram todas. Um mês do país inteiro ≈ 2.700 páginas, e o
// período que precisamos (2024-01 → hoje) ≈ 50 mil requisições — ~5 h em vez de dias.
// Em troca ela traz o país todo e não só saúde; só usamos o que já está na base.
//
// Só faz UPDATE de colunas NULAS (COALESCE) — nunca sobrescreve dado coletado.
// Restartável: o progresso vai para etl_checkpoint por (mês, modalidade).
//
// Uso:
//   node scripts/etl-enriquecer.mjs                    (2024-01 até hoje)
//   node scripts/etl-enriquecer.mjs --de=2026-01 --ate=2026-08
//   node scripts/etl-enriquecer.mjs --pausa=250

import fs from 'node:fs'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d }
const DE = arg('de', '2024-01')
const ATE = arg('ate', new Date().toISOString().slice(0, 7))
const PAUSA = Number(arg('pausa', '400'))
const BASE = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao'
const UA = 'GovHealth-ETL/1.0'

// Modalidades da Lei 14.133 que aparecem na saúde. 8 (dispensa) e 6 (pregão) são o
// grosso; as outras somam pouco mas custam poucas páginas.
const MODALIDADES = [1, 4, 5, 6, 8, 9, 12, 13]

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query("SET statement_timeout = '300s'")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ymd = (mes, dia) => `${mes.replace('-', '')}${dia}`
const ultimoDia = (mes) => {
  const [a, m] = mes.split('-').map(Number)
  return String(new Date(a, m, 0).getDate()).padStart(2, '0')
}

function meses(de, ate) {
  const out = []
  let [a, m] = de.split('-').map(Number)
  const [aF, mF] = ate.split('-').map(Number)
  while (a < aF || (a === aF && m <= mF)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; a++ }
  }
  return out
}

async function pagina(mes, mod, pag, tentativa = 0) {
  const url = `${BASE}?dataInicial=${ymd(mes, '01')}&dataFinal=${ymd(mes, ultimoDia(mes))}`
    + `&codigoModalidadeContratacao=${mod}&pagina=${pag}&tamanhoPagina=50`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 30000)
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: ac.signal })
    if (r.status === 204) return { data: [], totalPaginas: 0 }
    // 429 é limite de taxa, NÃO ausência de dado: recua e tenta de novo. Tratar como
    // falha definitiva marcaria como "sem valor" registros que o PNCP tem.
    if (r.status === 429) throw new Error('429')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } catch (e) {
    if (tentativa < 5) { await sleep(2000 * (tentativa + 1)); return pagina(mes, mod, pag, tentativa + 1) }
    return null
  } finally { clearTimeout(timer) }
}

const lerCp = async (chave) => Number(
  (await client.query(`SELECT ultima_pagina FROM etl_checkpoint WHERE chave = $1`, [chave])).rows[0]?.ultima_pagina ?? 0)
const salvarCp = (chave, p) => client.query(
  `INSERT INTO etl_checkpoint (chave, ultima_pagina, atualizado_em) VALUES ($1,$2,now())
   ON CONFLICT (chave) DO UPDATE SET ultima_pagina = EXCLUDED.ultima_pagina, atualizado_em = now()`, [chave, p])

/** UPDATE em lote: só toca linhas que existem na base E estão sem valor. */
async function gravar(lote) {
  if (!lote.length) return 0
  const vals = lote.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2}::numeric,$${i * 4 + 3},$${i * 4 + 4})`).join(',')
  const args = lote.flatMap((r) => [r.id, r.valor, r.modalidade, r.link])
  const res = await client.query(
    `UPDATE contratacoes c SET
       valor_total_estimado = COALESCE(c.valor_total_estimado, v.valor),
       modalidade_nome      = COALESCE(c.modalidade_nome, v.modalidade),
       link_externo         = COALESCE(c.link_externo, v.link)
     FROM (VALUES ${vals}) AS v(id, valor, modalidade, link)
     WHERE c.numero_controle_pncp = v.id AND c.valor_total_estimado IS NULL`, args)
  return res.rowCount ?? 0
}

const lista = meses(DE, ATE)
console.log(`[enriq] ${lista.length} mês(es) × ${MODALIDADES.length} modalidades · ${DE} → ${ATE} · pausa ${PAUSA}ms`)
let reqs = 0, vistos = 0, gravados = 0, furos = 0
const t0 = Date.now()

for (const mes of lista) {
  for (const mod of MODALIDADES) {
    const chave = `enriq:${mes}:${mod}`
    let pag = await lerCp(chave)
    if (pag === -1) continue                       // já concluído
    for (;;) {
      pag++
      const j = await pagina(mes, mod, pag)
      reqs++
      if (j === null) { furos++; break }            // desistiu após 5 tentativas
      const itens = j.data ?? []
      if (!itens.length) { await salvarCp(chave, -1); break }
      vistos += itens.length
      const lote = itens
        .filter((x) => x.numeroControlePNCP && x.valorTotalEstimado != null)
        .map((x) => ({ id: x.numeroControlePNCP, valor: x.valorTotalEstimado,
                       modalidade: x.modalidadeNome ?? null, link: x.linkSistemaOrigem ?? null }))
      gravados += await gravar(lote)
      await salvarCp(chave, pag)
      if (pag >= (j.totalPaginas ?? pag)) { await salvarCp(chave, -1); break }
      await sleep(PAUSA)
    }
  }
  const min = (Date.now() - t0) / 60000
  console.log(`[enriq] ${mes} · ${reqs} req · ${vistos.toLocaleString('pt-BR')} vistos · ${gravados.toLocaleString('pt-BR')} preenchidos · ${Math.round(reqs / Math.max(min, 0.01))} req/min`)
}

const falta = (await client.query(`SELECT count(*)::int n FROM contratacoes WHERE valor_total_estimado IS NULL`)).rows[0].n
console.log(`✓ Fim: ${gravados.toLocaleString('pt-BR')} contratações ganharam valor. Ainda sem valor: ${falta.toLocaleString('pt-BR')}. Páginas que furaram: ${furos}.`)
await client.end()
