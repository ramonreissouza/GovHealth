// scripts/lib/pg-ssl.teste.mjs — a regra de TLS, e os DOIS guardas que ela precisa.
//
// O modo de falha que originou este helper levou um ano e meio para aparecer, e
// reapareceu duas vezes na própria correção:
//
//   · `scripts/db-prune-estimate.mjs` manteve `ssl:{rejectUnauthorized:false}` porque o
//     regex da edição em massa esperava espaços — e a descrição do PR afirmou que
//     nenhum havia sobrado. Guarda 1 existe para essa afirmação parar de depender de
//     alguém lembrar de conferir.
//
//   · 5 scripts decidiam o TLS por `process.env.DATABASE_URL` e conectavam numa URL
//     vinda do `argv`, do `.env.local` ou de `dbUrl()`. Como o default do helper para
//     string ausente é LIGAR TLS, o resultado era exatamente o crash que ele conserta.
//     Guarda 2 procura esse descasamento.
//
// Os dois guardas leem o repositório, não a intenção.

import fs from 'node:fs'
import path from 'node:path'
import { sslParaHost, novoClient, novoPool } from './pg-ssl.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}\n         veio     ${JSON.stringify(valor)}`) }
}

// ── 1. a regra ──────────────────────────────────────────────────────────────
console.log('\na regra de TLS por host')
afirmar('localhost → sem TLS (é o túnel; ele já cifra)', sslParaHost('postgresql://u:p@localhost:5432/d'), false)
afirmar('127.0.0.1 → sem TLS', sslParaHost('postgresql://u:p@127.0.0.1:5432/d'), false)
afirmar('db (rede do compose) → sem TLS', sslParaHost('postgresql://u:p@db:5432/d'), false)
afirmar('IP público → TLS', sslParaHost('postgresql://u:p@163.176.103.191:6432/d'), { rejectUnauthorized: false })
afirmar('host nomeado → TLS', sslParaHost('postgresql://u:p@ep-x.neon.tech/d'), { rejectUnauthorized: false })
// String ilegível cai no default SEGURO — e agora avisa (o warn sai no stderr).
afirmar('string ilegível → TLS (default seguro)', sslParaHost('host=localhost port=5432'), { rejectUnauthorized: false })
afirmar('undefined → TLS (default seguro)', sslParaHost(undefined), { rejectUnauthorized: false })

// ── 2. as fábricas decidem e conectam com a MESMA string ───────────────────
console.log('\nfábricas')
{
  const c = novoClient('postgresql://u:p@localhost:5432/d')
  afirmar('novoClient(localhost) não liga TLS', c.connectionParameters.ssl ?? false, false)
  const p = novoPool('postgresql://u:p@1.2.3.4:5432/d')
  afirmar('novoPool(remoto) liga TLS', Boolean(p.options.ssl), true)
}

// ── GUARDA 1: nenhum `rejectUnauthorized` cravado fora dos dois donos ───────
console.log('\nguarda 1 — SSL cravado à mão')
const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const DONOS = ['scripts/lib/pg-ssl.mjs', 'scripts/lib/pg-ssl.teste.mjs', 'src/lib/db.ts']

function varrer(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) varrer(p, acc)
    else if (/\.(mjs|ts|tsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const arquivos = [...varrer(path.join(RAIZ, 'scripts')), ...varrer(path.join(RAIZ, 'src'))]
const cravados = []
for (const f of arquivos) {
  const rel = path.relative(RAIZ, f).replace(/\\/g, '/')
  if (DONOS.includes(rel)) continue
  // Sem espaços no padrão de propósito: foi um `ssl:{rejectUnauthorized:false}` colado
  // que escapou da primeira varredura.
  if (/rejectUnauthorized/.test(fs.readFileSync(f, 'utf8'))) cravados.push(rel)
}
afirmar('nenhum arquivo crava rejectUnauthorized', cravados, [])

// ── GUARDA 2: o TLS decidido para uma string, a conexão feita com outra ────
console.log('\nguarda 2 — TLS decidido para a string errada')
const descasados = []
for (const f of arquivos) {
  const rel = path.relative(RAIZ, f).replace(/\\/g, '/')
  if (DONOS.includes(rel)) continue
  const texto = fs.readFileSync(f, 'utf8')
  // `connectionString: X` e `ssl: sslParaHost(Y)` dentro da mesma expressão de objeto —
  // o par tem de citar a MESMA fonte.
  const re = /connectionString:\s*([A-Za-z_$][\w$.]*(?:\(\))?)[\s,\S]{0,200}?ssl:\s*sslParaHost\(\s*([A-Za-z_$][\w$.]*(?:\(\))?)\s*\)/g
  for (const m of texto.matchAll(re)) {
    if (m[1] !== m[2]) descasados.push(`${rel}: connectionString=${m[1]} mas ssl=sslParaHost(${m[2]})`)
  }
}
afirmar('toda conexão decide o TLS pela própria string', descasados, [])

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
