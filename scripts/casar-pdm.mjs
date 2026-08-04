// scripts/casar-pdm.mjs — casa a descrição de cada item com um PDM do CATMAT.
//
// É o que destrava o preço de referência: os itens têm CATMAT em 0,18% (e o PNCP
// não fornece — medi 0 de 306), mas o Painel de Preços do Compras.gov também aceita
// `codigoPdm`, e por PDM há MUITO mais preço (3.554 registros para o PDM 10436
// contra 7 para o item 401445).
//
// ESTRATÉGIA: contenção de TOKENS, não similaridade de string.
//
// O nome do PDM é curto e canônico ("AGULHA HIPODERMICA", "FIO SUTURA CATGUT",
// média de 20 caracteres) e as descrições de item começam pelo produto
// ("AGULHA HIPODERMICA DESC.13 X 4/4,5, COM DISPOSITIVO..."). Então:
//
//   1. tokenizo os dois lados (sem acento, minúsculo);
//   2. procuro a SEQUÊNCIA de tokens do PDM dentro dos tokens da descrição;
//   3. vence o casamento que começa MAIS PERTO DO INÍCIO; nº de tokens só desempata
//      ("FIO SUTURA CATGUT" ganha de "FIO SUTURA" na mesma posição).
//
// Por que token e não substring: substring cria casamento falso — o PDM "CUBA"
// casaria dentro de "cubagem". Comparando tokens, "cubagem" nunca é "cuba".
//
// Por que a POSIÇÃO importa: um PDM citado no meio de uma especificação
// ("...compatível com agulha hipodérmica...") é referência a outro produto, não o
// produto em disputa. Casamento que começa no primeiro token vale mais.
//
// Uso:
//   node scripts/casar-pdm.mjs            (ENSAIO — mede e mostra amostras)
//   node scripts/casar-pdm.mjs --aplicar  (grava itens.codigo_pdm)

import fs from 'node:fs'
import pg from 'pg'

const APLICAR = process.argv.includes('--aplicar')

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const norm = (s) => (s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Tokens sem valor discriminante: aparecem em quase toda descrição de compra
// pública e só geram casamento espúrio.
const VAZIOS = new Set(['de', 'da', 'do', 'com', 'sem', 'para', 'em', 'e', 'ou', 'a', 'o',
  'tipo', 'uso', 'un', 'und', 'unidade', 'aquisicao', 'material', 'p'])

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

// ── índice de PDMs por primeiro token ────────────────────────────────────────
const { rows: pdms } = await db.query(`SELECT codigo_pdm, nome, nome_norm FROM catmat_pdm`)
const porPrimeiro = new Map()
let descartados = 0
for (const p of pdms) {
  const toks = p.nome_norm.split(' ').filter((t) => t && !VAZIOS.has(t))
  // PDM de um único token curto ("cuba", "kit") casa com qualquer coisa. Exijo 4+
  // caracteres para token único; com 2+ tokens a combinação já é específica.
  if (!toks.length || (toks.length === 1 && toks[0].length < 5)) { descartados++; continue }
  const chave = toks[0]
  if (!porPrimeiro.has(chave)) porPrimeiro.set(chave, [])
  // PDM com '*' no nome é entrada LEGADA do catálogo. Medi: `AGULHA*` devolve 4
  // preços e `SERINGA*` devolve 2, enquanto os equivalentes vivos têm milhares.
  // São 28 PDMs desses, carregando 11.354 dos nossos itens. Quando existe um PDM
  // sem '*' com o mesmo nome (SERINGA, TUBO ENDOTRAQUEAL, CIMENTO ODONTOLÓGICO),
  // ele tem que ganhar — senão o casamento "acerta" e o preço vem vazio.
  porPrimeiro.get(chave).push({ codigo: p.codigo_pdm, nome: p.nome, toks, legado: p.nome.includes('*') })
}
// Ordem dos candidatos: vivo antes de legado, e mais tokens antes de menos — o
// primeiro casamento encontrado já é o melhor.
for (const lista of porPrimeiro.values()) {
  lista.sort((a, b) => (a.legado ? 1 : 0) - (b.legado ? 1 : 0) || b.toks.length - a.toks.length)
}
console.log(`${pdms.length} PDMs no catálogo · ${porPrimeiro.size} tokens iniciais distintos · ${descartados} descartados por serem genéricos demais`)

/** Sequência `agulha` dentro de `tokens`, a partir de qualquer posição. */
function posicaoDaSequencia(tokens, agulha) {
  for (let i = 0; i + agulha.length <= tokens.length; i++) {
    let bate = true
    for (let j = 0; j < agulha.length; j++) if (tokens[i + j] !== agulha[j]) { bate = false; break }
    if (bate) return i
  }
  return -1
}

// POSIÇÃO MÁXIMA do casamento. Medido variando 0..sem-limite:
//   pos 0 → 38,0% dos itens · pos 2 → 44,3% · pos 3 → 45,7% · sem limite → 54,4%
// Sem limite a cobertura é a maior e a qualidade despenca: aparece
// "[MATERIAL PARA DESINFECCAO] ← LIMPEZA E DESINFECÇÃO DE RESERVATÓRIO DE ÁGUA" e
// "[SUPORTE DE SORO] ← INCUBADORA DE TRANSPORTE" (casou com um item da
// especificação da incubadora, não com o produto).
//
// Fico em 2 de propósito: preço de referência ERRADO é pior que ausente, porque
// destrói a confiança na tela inteira — e foi exatamente essa desconfiança que
// abriu este trabalho. Subir para 3 rende +1,4pp se algum dia valer a troca.
const POS_MAX = 2

function casar(descricao) {
  const tokens = norm(descricao).split(' ').filter(Boolean)
  if (!tokens.length) return null
  let melhor = null
  // Só testo PDMs cujo primeiro token aparece na descrição — evita varrer 4.292
  // candidatos por item (696 mil itens × 4.292 seria inviável).
  const vistos = new Set()
  for (const t of tokens) {
    if (vistos.has(t)) continue
    vistos.add(t)
    for (const cand of porPrimeiro.get(t) ?? []) {
      const pos = posicaoDaSequencia(tokens, cand.toks)
      if (pos < 0 || pos > POS_MAX) continue
      // A POSIÇÃO manda, o nº de tokens só desempata. Estava invertido antes, e o
      // efeito era um casamento de 3 tokens no meio do texto vencer o nome do
      // produto na posição 0 — daí o "SUPORTE DE SORO" numa incubadora.
      const score = (POS_MAX - pos) * 100 + cand.toks.length
      if (!melhor || score > melhor.score) melhor = { ...cand, pos, score }
      break // lista ordenada: vivo/específico primeiro, então o 1o casamento é o melhor
    }
  }
  return melhor
}

// ── casamento sobre descrições DISTINTAS ─────────────────────────────────────
// A base repete muita descrição ("Fralda Descartável" aparece centenas de vezes).
// Casar o distinto e depois propagar por UPDATE ... FROM é o que torna 696 mil
// itens viável numa passada.
const { rows: distintas } = await db.query(
  `SELECT descricao, count(*) n FROM itens
    WHERE descricao IS NOT NULL AND length(descricao) > 3
    GROUP BY descricao`)
console.log(`${distintas.length} descrições distintas cobrindo ${distintas.reduce((s, d) => s + Number(d.n), 0)} itens`)

const casados = []
let itensCasados = 0, itensTotal = 0
for (const d of distintas) {
  itensTotal += Number(d.n)
  const m = casar(d.descricao)
  if (m) { casados.push({ descricao: d.descricao, codigo: m.codigo, nome: m.nome, toks: m.toks.length, pos: m.pos, n: Number(d.n) }); itensCasados += Number(d.n) }
}
const pctDesc = (casados.length / distintas.length * 100).toFixed(1)
const pctItens = (itensCasados / itensTotal * 100).toFixed(1)
console.log(`\nCASADOS: ${casados.length}/${distintas.length} descrições (${pctDesc}%) → ${itensCasados}/${itensTotal} itens (${pctItens}%)`)
console.log(`  antes: 1.254 itens com codigo_catmat (0,18%)`)

// Distribuição por especificidade — casamento de 1 token é o mais frágil.
const porToks = new Map()
for (const c of casados) porToks.set(c.toks, (porToks.get(c.toks) ?? 0) + 1)
console.log('\n  por nº de tokens do PDM casado (mais tokens = mais específico):')
for (const [t, n] of [...porToks].sort((a, b) => a[0] - b[0])) console.log(`    ${t} token(s): ${n} descrições`)

console.log('\n  amostra de 1 token (o grupo a auditar):')
for (const c of casados.filter((x) => x.toks === 1).slice(0, 6)) {
  console.log(`    [${c.nome}] ← ${c.descricao.replace(/\s+/g, ' ').slice(0, 78)}`)
}
console.log('\n  amostra de 2+ tokens:')
for (const c of casados.filter((x) => x.toks >= 2).slice(0, 6)) {
  console.log(`    [${c.nome}] ← ${c.descricao.replace(/\s+/g, ' ').slice(0, 78)}`)
}
console.log('\n  amostra do que NÃO casou:')
let mostrados = 0
for (const d of distintas) {
  if (casar(d.descricao)) continue
  console.log(`    · ${d.descricao.replace(/\s+/g, ' ').slice(0, 84)}`)
  if (++mostrados >= 6) break
}

if (!APLICAR) {
  console.log('\nEnsaio. Para gravar: node scripts/casar-pdm.mjs --aplicar')
  await db.end()
  process.exit(0)
}

// ── gravação ─────────────────────────────────────────────────────────────────
const LOTE = 500
let gravados = 0
for (let i = 0; i < casados.length; i += LOTE) {
  const lote = casados.slice(i, i + LOTE)
  const vals = [], params = []
  for (const c of lote) {
    const k = params.length
    vals.push(`($${k + 1},$${k + 2}::int,$${k + 3},$${k + 4}::numeric)`)
    params.push(c.descricao, c.codigo, c.pos === 0 ? 'inicio' : 'proximo_inicio', c.score)
  }
  const { rowCount } = await db.query(
    `UPDATE itens i SET codigo_pdm = v.cod, pdm_metodo = v.metodo, pdm_score = v.score
       FROM (VALUES ${vals.join(',')}) AS v(descr, cod, metodo, score)
      WHERE i.descricao = v.descr`, params)
  gravados += rowCount
  if (i % 5000 === 0) console.log(`  ${gravados} itens gravados…`)
}
const { rows: [f] } = await db.query(
  `SELECT count(*) total, count(codigo_pdm) com_pdm,
          count(*) FILTER (WHERE pdm_metodo='inicio') no_inicio,
          count(DISTINCT codigo_pdm) pdms_usados FROM itens`)
console.log(`\nfim — ${f.com_pdm}/${f.total} itens com PDM (${(f.com_pdm / f.total * 100).toFixed(1)}%), ${f.pdms_usados} PDMs distintos, ${f.no_inicio} casados na posição 0`)
await db.end()
