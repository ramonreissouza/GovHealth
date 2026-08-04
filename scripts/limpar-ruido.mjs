// scripts/limpar-ruido.mjs — tira da base o que não é oportunidade de saúde.
//
// Duas limpezas independentes, ambas medidas antes de escritas:
//
// (1) FORA DE ESCOPO — registros que o isSaude() de HOJE rejeita. A base foi
//     coletada com versões anteriores do filtro, então o débito é acumulado. O
//     caso dominante: 'gênero aliment' não casava com "gêneros alimentícios"
//     (o 's' do plural quebra a substring), e 626 compras de comida entraram na
//     base de saúde — uma delas classificada como 'uti'. Ver EXCLUI_RE em
//     saude-filter.mjs.
//
// (2) VALOR IMPOSSÍVEL — erro de digitação de quem publicou no PNCP. 24 registros
//     (0,026% da base) somavam 12x TUDO o resto: R$ 2,7 tri contra R$ 222,9 bi.
//     Isso contamina todo KPI de "valor total" do produto.
//
//     O limiar é ABSOLUTO (R$ 10 bi), não uma razão contra a mediana do órgão.
//     Testei a razão e ela reprova: a vacina da dengue do Ministério da Saúde
//     custa R$ 1,57 bi com razão 3.959 contra a mediana do próprio Ministério —
//     é contrato real, e um corte por razão o marcaria como lixo. Já R$ 10 bi
//     numa contratação isolada é fisicamente impossível: o orçamento federal de
//     saúde inteiro gira em ~R$ 200 bi por ANO.
//
//     Não apaga o registro nem o número: move para `valor_original` e põe NULL em
//     `valor_total_estimado`. Assim todo SUM/ORDER BY já existente fica correto
//     sem precisar tocar em 10 APIs (SUM ignora NULL), a tela mostra "—" como já
//     faz para valor ausente, e o dado continua auditável/reversível.
//
// Uso:
//   node scripts/limpar-ruido.mjs            (ENSAIO — não escreve nada)
//   node scripts/limpar-ruido.mjs --aplicar  (grava)
//   npm run ruido:limpar / npm run ruido:limpar -- --aplicar

import fs from 'node:fs'
import pg from 'pg'
import { isSaude } from './saude-filter.mjs'

const APLICAR = process.argv.includes('--aplicar')
const TETO_IMPOSSIVEL = 1e10   // R$ 10 bi

if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('.env.local', 'utf8')
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '')
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

console.log(APLICAR ? '=== APLICANDO ===\n' : '=== ENSAIO (nada será gravado) ===\n')

// ── (1) fora de escopo ───────────────────────────────────────────────────────
//
// NÃO usa `!isSaude()` para decidir o que apagar, e isso é deliberado. Olhei a
// amostra: `!isSaude()` mistura duas coisas com destinos opostos.
//
//   • RUÍDO — compra de comida/obra que nunca deveria ter entrado. Apagar.
//   • FALHA DE ALCANCE do filtro — registro de saúde legítimo que não tem nenhum
//     termo da lista SAUDE: "KIT DE HEMOGASOMETRIA", "DIFUSÃO MONÓXIDO DE
//     CARBONO" (exame de função pulmonar), "Locação de Equipamentos Analisadores
//     Totalmente Automatizados". Apagar ISSO seria tirar lead bom do cliente.
//
// Então só entra na fila de exclusão quem casa nos padrões de EXCLUI_RE — o
// conjunto medido do bug do plural. E mesmo aí, uma compra MISTA que carregue
// produto de saúde de verdade ("MEDICAMENTOS, FRALDAS E GÊNEROS ALIMENTÍCIOS")
// fica: o fornecedor pode disputar a parte dele.
const RUIDO_RE = [
  /(^|[^a-zà-ú])g[êe]neros?\s+aliment/i,
  /(^|[^a-zà-ú])cestas?\s+b[áa]sicas?/i,
  /(^|[^a-zà-ú])uniformes?\s+escolar/i,
  /(^|[^a-zà-ú])(obras?|constru[çc][õo]es)\s+de\s+(engenharia|constru|reforma|amplia|adequa|infraestrutura)/i,
]
const PRODUTO_SAUDE_RE = /medicament|f[áa]rmac|fralda|material (m[ée]dic|hospitalar|penso)|equipament|insumo|seringa|cateter|luva|gaze|reagente|vacina|pr[óo]tese|[óo]rtese/i

const { rows: todos } = await db.query(
  `SELECT numero_controle_pncp ncp, objeto_compra obj, categoria_saude cat
     FROM contratacoes WHERE objeto_compra IS NOT NULL`)

const casaRuido = todos.filter((r) => RUIDO_RE.some((re) => re.test(r.obj)))
const mistos = casaRuido.filter((r) => PRODUTO_SAUDE_RE.test(r.obj))
const fora = casaRuido.filter((r) => !PRODUTO_SAUDE_RE.test(r.obj))

// Falhas de alcance: reprovam no isSaude() mas não são ruído. Só REPORTA.
const alcance = todos.filter((r) => !isSaude(r.obj) && !RUIDO_RE.some((re) => re.test(r.obj)))

console.log(`(1) RUÍDO (comida/obra/uniforme): ${casaRuido.length} registros`)
console.log(`      ${fora.length} para apagar`)
console.log(`      ${mistos.length} MISTOS preservados (têm produto de saúde no mesmo objeto)`)
for (const r of mistos.slice(0, 4)) console.log(`        · ${r.obj.replace(/\s+/g, ' ').slice(0, 92)}`)
console.log(`\n    ${alcance.length} registros reprovam no isSaude() por FALTA DE ALCANCE, não por ruído —`)
console.log(`      PRESERVADOS (apagá-los tiraria lead bom). São candidatos a novo termo em SAUDE:`)
for (const r of alcance.slice(0, 6)) console.log(`        · (${r.cat}) ${r.obj.replace(/\s+/g, ' ').slice(0, 88)}`)
console.log('')

const ncps = fora.map((r) => r.ncp)
// Contagem das DEPENDÊNCIAS antes de qualquer DELETE. `itens` tem FK declarada
// (apagar contratacoes sem apagar itens falha); `resultados` não tem FK, então
// sobraria órfão e a tela de Vencedores continuaria mostrando comida homologada.
const dep = {}
for (const t of ['itens', 'resultados']) {
  const { rows: [r] } = await db.query(
    `SELECT count(*) n FROM ${t} WHERE numero_controle_pncp = ANY($1)`, [ncps])
  dep[t] = Number(r.n)
}
console.log(`    dependências: ${dep.itens} itens, ${dep.resultados} resultados`)
const porCat = new Map()
for (const r of fora) porCat.set(r.cat, (porCat.get(r.cat) ?? 0) + 1)
console.log('    por categoria: ' + [...porCat].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(' '))
console.log('    amostra:')
for (const r of fora.slice(0, 5)) console.log(`      · ${r.obj.slice(0, 96)}`)

// ── (2) valor impossível ─────────────────────────────────────────────────────
const { rows: absurdos } = await db.query(
  `SELECT numero_controle_pncp ncp, valor_total_estimado v, razao_social_orgao org, left(objeto_compra,60) obj
     FROM contratacoes WHERE valor_total_estimado >= $1 ORDER BY valor_total_estimado DESC`,
  [TETO_IMPOSSIVEL])
const { rows: [somas] } = await db.query(
  `SELECT sum(valor_total_estimado) tudo,
          sum(valor_total_estimado) FILTER (WHERE valor_total_estimado < $1) sem
     FROM contratacoes`, [TETO_IMPOSSIVEL])
console.log(`\n(2) VALOR IMPOSSÍVEL (>= ${brl(TETO_IMPOSSIVEL)}): ${absurdos.length} registros`)
console.log(`    soma da base hoje : ${brl(somas.tudo)}`)
console.log(`    soma sem eles     : ${brl(somas.sem)}`)
for (const r of absurdos) console.log(`      · ${brl(r.v)} | ${(r.org ?? '').slice(0, 30)} | ${r.obj}`)

if (!APLICAR) {
  console.log('\nEnsaio. Para gravar: node scripts/limpar-ruido.mjs --aplicar')
  await db.end()
  process.exit(0)
}

// ── escrita ──────────────────────────────────────────────────────────────────
// Numa transação só: ou a base fica consistente, ou nada muda.
await db.query('BEGIN')
try {
  await db.query(`ALTER TABLE contratacoes ADD COLUMN IF NOT EXISTS valor_original NUMERIC`)

  const { rowCount: nAbs } = await db.query(
    `UPDATE contratacoes
        SET valor_original = valor_total_estimado, valor_total_estimado = NULL
      WHERE valor_total_estimado >= $1`, [TETO_IMPOSSIVEL])
  console.log(`\nvalor neutralizado: ${nAbs} registros (original guardado em valor_original)`)

  // DESPEJO ANTES DE APAGAR. São 24 mil linhas de produção somando três tabelas;
  // sem isto, um erro de julgamento meu sobre um padrão seria irreversível. Com o
  // arquivo, dá para reinserir. Fica fora do git (é dado de produção).
  const dump = { gerado: new Date().toISOString(), criterio: 'RUIDO_RE sem produto de saúde', contratacoes: [], itens: [], resultados: [] }
  for (const t of ['contratacoes', 'itens', 'resultados']) {
    const { rows } = await db.query(`SELECT * FROM ${t} WHERE numero_controle_pncp = ANY($1)`, [ncps])
    dump[t] = rows
  }
  const arq = `.limpeza-ruido-${Date.now()}.json`
  fs.writeFileSync(arq, JSON.stringify(dump), 'utf8')
  console.log(`despejo salvo em ${arq} (${dump.contratacoes.length}+${dump.itens.length}+${dump.resultados.length} linhas)`)

  // ORDEM OBRIGATÓRIA: resultados -> itens -> contratacoes.
  // A cadeia de FKs não é a óbvia: `resultados` aponta para `itens` pela chave
  // COMPOSTA (numero_controle_pncp, numero_item), e `itens` aponta para
  // `contratacoes`. Apagar itens antes de resultados viola
  // resultados_numero_controle_pncp_numero_item_fkey — foi o que a primeira
  // execução tentou fazer, e o BEGIN/ROLLBACK desfez tudo sem estrago.
  let apagados = { itens: 0, resultados: 0, contratacoes: 0 }
  const LOTE = 500
  for (let i = 0; i < ncps.length; i += LOTE) {
    const lote = ncps.slice(i, i + LOTE)
    apagados.resultados += (await db.query(`DELETE FROM resultados WHERE numero_controle_pncp = ANY($1)`, [lote])).rowCount
    apagados.itens += (await db.query(`DELETE FROM itens WHERE numero_controle_pncp = ANY($1)`, [lote])).rowCount
    apagados.contratacoes += (await db.query(`DELETE FROM contratacoes WHERE numero_controle_pncp = ANY($1)`, [lote])).rowCount
  }
  console.log(`apagados: ${apagados.contratacoes} contratações, ${apagados.itens} itens, ${apagados.resultados} resultados`)

  await db.query('COMMIT')
  const { rows: [fim] } = await db.query(
    `SELECT count(*) n, sum(valor_total_estimado) soma FROM contratacoes`)
  console.log(`\nbase agora: ${fim.n} contratações, soma ${brl(fim.soma)}`)
} catch (e) {
  await db.query('ROLLBACK')
  console.error('ROLLBACK —', e.message)
  process.exitCode = 1
}
await db.end()
