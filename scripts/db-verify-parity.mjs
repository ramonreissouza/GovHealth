// scripts/db-verify-parity.mjs — prova de paridade Neon × Oracle ANTES do cutover.
//
// Compara os dois bancos e imprime PASS/FAIL por tabela:
//   1) contagem exata de linhas (count(*)) em cada tabela do schema public;
//   2) checksums de conteúdo nas tabelas grandes (soma de colunas numéricas +
//      contagem de chaves distintas) para pegar divergência de dados, não só de linhas.
//
// Só faz LEITURA nos dois lados. Sai com código 1 se qualquer tabela divergir.
//
// Uso:
//   DATABASE_URL_NEON=...   (origem)   — cai p/ DATABASE_URL do .env.local se ausente
//   DATABASE_URL_ORACLE=... (destino)
//   node scripts/db-verify-parity.mjs
//
// As duas URLs podem estar no .env.local (ele é gitignored).

import fs from 'node:fs'
import pg from 'pg'

// ---- carrega variáveis do .env.local (mesma convenção dos outros scripts) ----
function loadEnv(name) {
  if (process.env[name]) return process.env[name]
  try {
    const env = fs.readFileSync('.env.local', 'utf8')
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* sem .env.local */ }
  return undefined
}

const NEON = loadEnv('DATABASE_URL_NEON') || loadEnv('DATABASE_URL')
const ORACLE = loadEnv('DATABASE_URL_ORACLE')

if (!NEON || !ORACLE) {
  console.error('ERRO: defina DATABASE_URL_NEON (ou DATABASE_URL) e DATABASE_URL_ORACLE.')
  console.error('  Ex.: no .env.local, DATABASE_URL_NEON=<url antiga do Neon>')
  console.error('       e DATABASE_URL_ORACLE=postgres://user:senha@IP:6432/db?sslmode=require')
  process.exit(1)
}

// Checksums extras nas tabelas grandes (chave natural + soma numérica).
// Se uma tabela não existir, o bloco é ignorado com segurança.
const CHECKS = {
  contratacoes: `SELECT count(*) AS linhas,
                        count(DISTINCT numero_controle_pncp) AS chaves,
                        round(coalesce(sum(valor_total_estimado),0)::numeric, 2) AS soma
                 FROM contratacoes`,
  itens: `SELECT count(*) AS linhas,
                 count(DISTINCT (numero_controle_pncp, numero_item)) AS chaves,
                 round(coalesce(sum(valor_unitario_estimado),0)::numeric, 2) AS soma
          FROM itens`,
  resultados: `SELECT count(*) AS linhas,
                      count(DISTINCT (numero_controle_pncp, numero_item, ni_fornecedor)) AS chaves,
                      round(coalesce(sum(valor_total_homologado),0)::numeric, 2) AS soma
               FROM resultados`,
}

function conn(url) {
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

async function tableList(client) {
  const r = await client.query(`
    SELECT c.relname AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY c.relname`)
  return r.rows.map((x) => x.t)
}

async function exactCount(client, table) {
  const r = await client.query(`SELECT count(*)::bigint AS n FROM "${table}"`)
  return r.rows[0].n
}

const neon = conn(NEON)
const oracle = conn(ORACLE)
let fails = 0

try {
  await neon.connect()
  await oracle.connect()

  const [tNeon, tOracle] = [await tableList(neon), await tableList(oracle)]
  const onlyNeon = tNeon.filter((t) => !tOracle.includes(t))
  const onlyOracle = tOracle.filter((t) => !tNeon.includes(t))
  if (onlyNeon.length) { console.log('⚠️  Tabelas SÓ no Neon (faltam no Oracle):', onlyNeon.join(', ')); fails += onlyNeon.length }
  if (onlyOracle.length) console.log('ℹ️  Tabelas só no Oracle (extras):', onlyOracle.join(', '))

  console.log('\nPARIDADE DE LINHAS (count exato)')
  console.log('TABELA'.padEnd(26), 'NEON'.padStart(12), 'ORACLE'.padStart(12), '  STATUS')
  console.log('-'.repeat(64))
  for (const t of tNeon) {
    if (!tOracle.includes(t)) continue
    const [a, b] = [await exactCount(neon, t), await exactCount(oracle, t)]
    const ok = a === b
    if (!ok) fails++
    console.log(String(t).padEnd(26), String(a).padStart(12), String(b).padStart(12), ok ? '  ✅' : '  ❌ DIVERGE')
  }

  console.log('\nCHECKSUMS DE CONTEÚDO (tabelas grandes)')
  for (const [t, sql] of Object.entries(CHECKS)) {
    if (!tNeon.includes(t) || !tOracle.includes(t)) continue
    try {
      const [a, b] = [(await neon.query(sql)).rows[0], (await oracle.query(sql)).rows[0]]
      const ok = a.linhas === b.linhas && a.chaves === b.chaves && String(a.soma) === String(b.soma)
      if (!ok) fails++
      console.log(`  ${t}: ${ok ? '✅' : '❌ DIVERGE'}`)
      if (!ok) {
        console.log(`     NEON   linhas=${a.linhas} chaves=${a.chaves} soma=${a.soma}`)
        console.log(`     ORACLE linhas=${b.linhas} chaves=${b.chaves} soma=${b.soma}`)
      }
    } catch (e) { console.log(`  ${t}: (checksum falhou: ${e.message})`) }
  }

  console.log('\n' + (fails === 0
    ? '✅ PASS — bancos idênticos. Pode fazer o cutover.'
    : `❌ FAIL — ${fails} divergência(s). NÃO faça o cutover; refaça o restore.`))
  process.exitCode = fails === 0 ? 0 : 1
} catch (e) {
  console.error('Falha:', e.message)
  process.exitCode = 1
} finally {
  await neon.end().catch(() => {})
  await oracle.end().catch(() => {})
}
