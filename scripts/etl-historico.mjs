// scripts/etl-historico.mjs — CATALOGAÇÃO HISTÓRICA pelo MOTOR DE BUSCA do PNCP.
//
// POR QUE EXISTE (medido em 2026-08-04): o etl-backfill/etl-pncp dependem de
// `/api/consulta/v1/contratacoes/publicacao`, e essa API inteira estava em 503 —
// publicacao, atualizacao, contratos e atas, todas falhando aos ~20,7s (timeout de
// gateway). Confirmado que NÃO era o nosso IP: a API de detalhe (`/api/pncp/v1`)
// respondia 200 em 0,8s da mesma máquina, e a listagem também falhava a partir de
// outra rede. Com a listagem fora, a coleta histórica ficava simplesmente parada.
//
// Este coletor usa o OUTRO canal, o mesmo que o site pncp.gov.br consome:
// `/api/search/` (Elasticsearch, index "catalog2"). Além de estar no ar, ele é
// estruturalmente mais rápido:
//
//   • 500 registros por pedido (a API de consulta dá 50) → 10x menos requisições;
//   • suporta concorrência: medido 245 registros/s com 6 workers (49/s com 1);
//   • traz num só pedido TODOS os 13 campos que o cabeçalho precisa, incluindo
//     `tem_resultado` — que diz de antemão se vale buscar resultados no 2º passe.
//
// LIMITES REAIS DESSE CANAL (medidos, não supostos):
//   1. NÃO tem filtro de data. O único recorte temporal é `anos`, que filtra o ANO
//      DA COMPRA (não o da publicação: um ano=2025 pode ter publicação em 2024-10).
//   2. Janela do Elasticsearch: `pagina × tam_pagina` tem que ser < 10.000. Página
//      20 de 500 passa; a 21 devolve 400 "Janela de resultados muito grande". Ou
//      seja, cada recorte só entrega 10.000 registros — daí a subdivisão adaptativa.
//   3. Multivalor NÃO é OR: nem `municipios=a,b` nem `municipios=a&municipios=b`
//      (o último vence). Um valor por eixo, por consulta.
//   4. `/api/search/filters` IGNORA os filtros da consulta: devolve sempre as
//      facetas globais. Não serve para dimensionar um recorte.
//   5. NÃO traz data de abertura/encerramento de proposta (a API de consulta traz).
//      Por isso o UPSERT usa COALESCE nessas colunas: nunca apaga o que já existe.
//
// O filtro de saúde continua LOCAL (scripts/saude-filter.mjs) de propósito: o
// `isSaude` casa por PREFIXO ('médic' pega "médico"/"medicamento") e tem uma segunda
// camada de exclusão, enquanto o `q` do Elasticsearch casa por TOKEN. Empurrar o
// filtro para o servidor perderia recall em silêncio, e a definição de "saúde" tem
// que ser uma só entre coleta e limpeza.
//
// Uso:  npm run etl:historico
//   HIST_ANOS=2026,2025     anos de compra a varrer (mais recente → mais antigo)
//   HIST_MODALIDADES=4,5,6,8,9,12
//   HIST_CONC=6             workers concorrentes (6 foi o ótimo medido)
//   HIST_UF=SP,MG,...       sobrepõe a lista das 27 (ordem de volume)
//   HIST_SO_PLANO=1         só imprime o plano de trabalho e sai (não grava nada)
//
// Idempotente (UPSERT + checkpoint por recorte/página) e restartável: se cair, roda
// de novo que retoma. Grava SÓ o cabeçalho — itens/resultados ficam para o 2º passe
// (etl-enriquecer.mjs), que usa a API de detalhe, essa sim saudável.

import fs from 'node:fs'
import pg from 'pg'
import { isSaude, categoria } from './saude-filter.mjs'

// ── env ──────────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  try {
    const m = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* noop */ }
}
if (!process.env.DATABASE_URL) { console.error('ERRO: DATABASE_URL não configurada.'); process.exit(1) }

const ANOS = (process.env.HIST_ANOS ?? '2026,2025').split(',').map((s) => s.trim()).filter(Boolean)
const MODS = (process.env.HIST_MODALIDADES ?? '4,5,6,8,9,12').split(',').map((s) => s.trim()).filter(Boolean)
const UFS = (process.env.HIST_UF ?? 'SP,MG,GO,BA,RJ,CE,ES,DF,AM,RS,PR,MA,PE,SC,PA,AL,PB,RN,MS,PI,SE,TO,MT,RO,AC,RR,AP')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const CONC = Math.max(1, Number(process.env.HIST_CONC ?? 6))
const SO_PLANO = process.env.HIST_SO_PLANO === '1'

const BUSCA = 'https://pncp.gov.br/api/search/'
const TAM = 500          // registros por pedido (máximo útil medido)
const JANELA = 10000     // teto do Elasticsearch: pagina × tam_pagina < 10.000
const MAX_PAG = Math.floor(JANELA / TAM) // = 20

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ts = () => new Date().toLocaleTimeString('pt-BR')

// ── HTTP ─────────────────────────────────────────────────────────────────────
// A busca falha de forma transitória com frequência alta (medido: ~25% das páginas
// de 500 num teste de 8), mas o retry resolve. Erro 400 de "janela muito grande" NÃO
// é transitório: é o teto, e não deve ser retentado.
async function buscar(params, tent = 0) {
  const sp = new URLSearchParams({ tipos_documento: 'edital', status: 'todos', ordenacao: '-data', ...params })
  try {
    const res = await fetch(`${BUSCA}?${sp}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) })
    const txt = await res.text()
    if (res.status === 400 && /Janela de resultados/i.test(txt)) return { teto: true }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${txt.slice(0, 60)}`)
    return JSON.parse(txt)
  } catch (e) {
    if (tent < 6) { await sleep(1500 * (tent + 1)); return buscar(params, tent + 1) }
    return { erro: String(e.message).slice(0, 80) }
  }
}
const contar = async (p) => (await buscar({ ...p, pagina: '1', tam_pagina: '1' })).total ?? null

// ── DB ───────────────────────────────────────────────────────────────────────
function novoDb() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  c.on('error', (e) => console.warn(`  [db] ${e.message} (reconecta sob demanda)`))
  return c
}
let db = novoDb()
await db.connect()
async function dbQuery(text, params, tent = 0) {
  try { return await db.query(text, params) } catch (e) {
    if (tent < 5) {
      try { await db.end() } catch { /* noop */ }
      db = novoDb()
      try { await db.connect() } catch { /* tenta de novo */ }
      await sleep(1200 * (tent + 1))
      return dbQuery(text, params, tent + 1)
    }
    throw e
  }
}

// COALESCE nas 3 colunas que a BUSCA não traz (datas de proposta e link do portal):
// uma releitura por este canal jamais pode apagar o que a API de consulta já gravou.
async function upsert(r) {
  await dbQuery(
    `INSERT INTO contratacoes (numero_controle_pncp, cnpj_orgao, razao_social_orgao, municipio, uf,
       modalidade_nome, objeto_compra, ano_compra, sequencial_compra, valor_total_estimado,
       data_publicacao, situacao_id, categoria_saude, fonte)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pncp')
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       valor_total_estimado = COALESCE(EXCLUDED.valor_total_estimado, contratacoes.valor_total_estimado),
       situacao_id = COALESCE(EXCLUDED.situacao_id, contratacoes.situacao_id),
       categoria_saude = EXCLUDED.categoria_saude,
       razao_social_orgao = COALESCE(EXCLUDED.razao_social_orgao, contratacoes.razao_social_orgao),
       municipio = COALESCE(EXCLUDED.municipio, contratacoes.municipio)`,
    [r.numero_controle_pncp, r.orgao_cnpj ?? '', r.orgao_nome ?? null, r.municipio_nome ?? null,
     r.uf ?? null, r.modalidade_licitacao_nome ?? null, r.description ?? null,
     r.ano ? Number(r.ano) : null, r.numero_sequencial ? Number(r.numero_sequencial) : null,
     r.valor_global ?? null, (r.data_publicacao_pncp ?? '').slice(0, 10) || null,
     r.situacao_id ? Number(r.situacao_id) : null, categoria(r.description)],
  )
}

const lerCp = async (k) => (await dbQuery('SELECT ultima_pagina FROM etl_checkpoint WHERE chave=$1', [k])).rows[0]?.ultima_pagina ?? 0
const salvarCp = (k, p) => dbQuery(
  `INSERT INTO etl_checkpoint (chave, ultima_pagina) VALUES ($1,$2)
   ON CONFLICT (chave) DO UPDATE SET ultima_pagina=EXCLUDED.ultima_pagina, atualizado_em=now()`, [k, p])

// ── mapa município→UF (só para subdividir recortes acima do teto) ────────────
// A faceta global traz {id, nome, total} SEM a UF, e `/api/search/filters` ignora os
// filtros da consulta, então não há como pedir "os municípios de SP". Duas armadilhas
// que este bloco existe para evitar:
//
//  1) Casar o nome do município contra o NOSSO banco parece suficiente, mas cobre só
//     os municípios que já temos: para SP daria 556 de 645. Os 89 restantes sairiam
//     silenciosamente da coleta — justamente o tipo de furo invisível que não pode
//     acontecer num recorte que só entrega 10.000 de 40.072 registros.
//  2) O cache da faceta precisa memoizar a PROMESSA, não o array. Na 1ª versão o
//     `FACETA_MUN = []` era atribuído ANTES do await, e como `[]` é truthy os outros
//     workers concorrentes achavam que já estava carregado e recebiam zero municípios
//     (medido: "2026/mod6/BA = 12134 → subdividindo em 0 municípios").
//
// Solução: resolver a UF de cada id UMA vez (1 pedido de 1 registro por id) e gravar
// em disco. São ~5.400 pedidos, ~15min na primeira execução e zero nas seguintes.
const CACHE_MUN = '.pncp-municipios.json'
let promessaMun = null

async function mapaMunicipios() {
  if (promessaMun) return promessaMun
  promessaMun = (async () => {
    if (fs.existsSync(CACHE_MUN)) {
      const m = JSON.parse(fs.readFileSync(CACHE_MUN, 'utf8'))
      console.log(`[hist] mapa de municípios do cache: ${m.length} com UF resolvida`)
      return m
    }
    let faceta = []
    try {
      const res = await fetch('https://pncp.gov.br/api/search/filters?tipos_documento=edital',
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(120000) })
      faceta = ((await res.json()).filters ?? {}).municipios ?? []
    } catch (e) {
      console.warn(`  [facetas] falhou (${e.message.slice(0, 50)}) — recortes acima do teto ficarão PARCIAIS`)
      return []
    }
    console.log(`[hist] resolvendo a UF de ${faceta.length} municípios (uma vez só; vai para ${CACHE_MUN})…`)
    const out = []
    let i = 0, feitos = 0
    const worker = async () => {
      for (;;) {
        const m = faceta[i++]
        if (!m) return
        const j = await buscar({ municipios: m.id, pagina: '1', tam_pagina: '1' })
        const uf = j.items?.[0]?.uf
        if (uf) out.push({ id: m.id, nome: m.nome, uf })
        if (++feitos % 500 === 0) console.log(`  [mapa] ${feitos}/${faceta.length} (${out.length} com UF)`)
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker))
    fs.writeFileSync(CACHE_MUN, JSON.stringify(out))
    console.log(`[hist] mapa pronto: ${out.length} municípios com UF → ${CACHE_MUN}`)
    return out
  })()
  return promessaMun
}

async function municipiosDaUf(uf) {
  return (await mapaMunicipios()).filter((m) => m.uf === uf)
}

// ── varredura de um recorte ──────────────────────────────────────────────────
let totVistos = 0, totSaude = 0, totGravados = 0, totRecortes = 0, totTeto = 0
const t0 = Date.now()

// Quanto cada recorte-pai (o que passou do teto) rendeu somando seus municípios —
// base da reconciliação final. Um pai que leia MENOS que seu total significa que a
// subdivisão não cobriu tudo, e isso tem que aparecer no log em vez de passar como
// "coleta concluída".
const lidoPorPai = new Map()
let totPaginasFuradas = 0

// Uma página que esgota as 7 tentativas do `buscar` NÃO pode abortar o recorte inteiro.
// Foi o que aconteceu na 1ª coleta: 287 `fetch failed` (0,014% dos pedidos) derrubaram
// 18 dos 54 recortes subdivididos, um deles em 31% do total — o prejuízo não foi a
// página perdida, foi tudo que vinha DEPOIS dela.
//
// Como as páginas são offsets independentes, dá para pular a que falhou e seguir. O
// cuidado é com o checkpoint: ele é uma marca d'água única, então se avançasse por
// cima do furo a página perdida nunca mais seria retentada. Por isso ele congela na
// última página contígua boa — a varredura continua até o fim, e uma reexecução
// retoma a partir do furo (o UPSERT torna a sobreposição inofensiva).
async function varrer(recorte, rotulo, pai) {
  const chave = `hist:${rotulo}`
  const de = await lerCp(chave)
  if (de >= MAX_PAG) return
  let contiguo = de
  for (let pagina = de + 1; pagina <= MAX_PAG; pagina++) {
    const j = await buscar({ ...recorte, pagina: String(pagina), tam_pagina: String(TAM) })
    if (j.teto) break
    if (j.erro) {
      console.warn(`  [erro] ${rotulo} pág ${pagina}: ${j.erro} — pula a página e segue`)
      totPaginasFuradas++
      continue
    }
    const itens = j.items ?? []
    if (itens.length === 0) break
    totVistos += itens.length
    if (pai) lidoPorPai.set(pai.rotulo, (lidoPorPai.get(pai.rotulo) ?? 0) + itens.length)
    const saude = itens.filter((r) => isSaude(r.description))
    totSaude += saude.length
    for (const r of saude) { await upsert(r); totGravados++ }
    if (pagina === contiguo + 1) { contiguo = pagina; await salvarCp(chave, pagina) }
    if (itens.length < TAM) break
  }
}

// ── plano de trabalho ────────────────────────────────────────────────────────
// Dimensiona TODOS os recortes antes de baixar: assim o log diz de antemão quanto
// há para fazer, e os que passam do teto de 10.000 já saem subdivididos.
console.log(`[hist] anos=${ANOS.join(',')} modalidades=${MODS.join(',')} ufs=${UFS.length} conc=${CONC} tam_pagina=${TAM}`)
console.log(`[hist] dimensionando ${ANOS.length * MODS.length * UFS.length} recortes (ano × modalidade × uf)…`)

const trabalhos = []
const pais = [] // recortes que passaram do teto, p/ reconciliar no fim
{
  const pares = []
  for (const ano of ANOS) for (const mod of MODS) for (const uf of UFS) pares.push({ ano, mod, uf })
  let i = 0
  const worker = async () => {
    for (;;) {
      const p = pares[i++]
      if (!p) return
      const base = { anos: p.ano, modalidades: p.mod, ufs: p.uf }
      const total = await contar(base)
      if (!total) continue
      if (total < JANELA) { trabalhos.push({ recorte: base, rotulo: `${p.ano}:${p.mod}:${p.uf}`, total }); continue }
      // Acima do teto: subdivide por município (um valor por consulta — multivalor
      // não é OR neste endpoint), mantendo `ufs` fixo.
      totTeto++
      const rotuloPai = `${p.ano}:${p.mod}:${p.uf}`
      const muns = await municipiosDaUf(p.uf)
      console.log(`  [teto] ${rotuloPai} = ${total} > ${JANELA} → subdividindo em ${muns.length} municípios`)
      if (muns.length === 0) {
        // Sem mapa não há subdivisão possível: coleta o que a janela permite e AVISA,
        // em vez de deixar o recorte parecer completo.
        console.warn(`  [PARCIAL] ${rotuloPai}: sem municípios no mapa — só os ${JANELA} mais recentes serão lidos`)
        trabalhos.push({ recorte: base, rotulo: rotuloPai, total: JANELA })
        continue
      }
      pais.push({ rotulo: rotuloPai, total })
      for (const m of muns) {
        trabalhos.push({ recorte: { ...base, municipios: m.id }, rotulo: `${rotuloPai}:m${m.id}`, total: null, pai: { rotulo: rotuloPai } })
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
}

const somaConhecida = trabalhos.reduce((s, t) => s + (t.total ?? 0), 0)
console.log(`[hist] plano: ${trabalhos.length} recortes · ${somaConhecida.toLocaleString('pt-BR')} registros dimensionados · ${totTeto} recortes subdivididos`)
console.log(`[hist] estimativa a 245 reg/s: ${(somaConhecida / 245 / 3600).toFixed(1)}h (mais os subdivididos)`)
if (SO_PLANO) { console.log('[hist] HIST_SO_PLANO=1 — nada foi gravado.'); await db.end(); process.exit(0) }

// ── execução ─────────────────────────────────────────────────────────────────
let k = 0
const progresso = setInterval(() => {
  const min = (Date.now() - t0) / 60000
  console.log(`[hist] ${ts()} ${totRecortes}/${trabalhos.length} recortes · ${totVistos.toLocaleString('pt-BR')} vistos · ${totSaude.toLocaleString('pt-BR')} saúde · ${totGravados.toLocaleString('pt-BR')} gravados · ${Math.round(totVistos / Math.max(min, 0.1))}/min`)
}, 60000)

const executor = async () => {
  for (;;) {
    const t = trabalhos[k++]
    if (!t) return
    await varrer(t.recorte, t.rotulo, t.pai)
    totRecortes++
  }
}
await Promise.all(Array.from({ length: CONC }, executor))
clearInterval(progresso)

const min = ((Date.now() - t0) / 60000).toFixed(1)
console.log(`\n[hist] concluído em ${min}min · ${totVistos.toLocaleString('pt-BR')} registros lidos · ${totSaude.toLocaleString('pt-BR')} de saúde · ${totGravados.toLocaleString('pt-BR')} gravados`)
if (totPaginasFuradas) console.warn(`[hist] ${totPaginasFuradas} páginas furaram após 7 tentativas; o checkpoint parou antes de cada furo — rode de novo para retomá-las`)

// Reconciliação: um recorte subdividido tem que somar ~o total do pai. Se ficar
// abaixo, a subdivisão deixou município de fora e o log precisa dizer isso.
if (pais.length) {
  const faltou = pais.map((p) => ({ ...p, lido: lidoPorPai.get(p.rotulo) ?? 0 }))
    .filter((p) => p.lido < p.total * 0.95)
  if (faltou.length === 0) {
    console.log(`[hist] reconciliação: ${pais.length} recortes subdivididos fecharam com o total esperado`)
  } else {
    console.warn(`[hist] ATENÇÃO — ${faltou.length} de ${pais.length} recortes subdivididos leram MENOS que o total:`)
    for (const p of faltou) console.warn(`   ${p.rotulo}: leu ${p.lido.toLocaleString('pt-BR')} de ${p.total.toLocaleString('pt-BR')} (${Math.round(100 * p.lido / p.total)}%)`)
  }
}
await db.end()
