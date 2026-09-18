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

/**
 * COMENTÁRIO NÃO PODE CEGAR O GUARDA — e cegava.
 *
 * A primeira versão do guarda 2 casava `connectionString: X … ssl: sslParaHost(Y)` com
 * uma janela de 200 caracteres entre os dois. Só que a correção de `db-check-oracle.mjs`
 * pôs um comentário de 4 linhas (~320 chars) explicando o defeito exatamente ali no
 * meio — e o guarda deixou de enxergar o arquivo que o motivou. Reintroduzi o defeito
 * lá e o teste continuou verde: 11/11.
 *
 * O detalhe é perverso: quanto melhor o comentário, mais cego o guarda. Provei o guarda
 * mordendo nos seeds, que são o par adjacente, e não no arquivo que importava.
 *
 * Então o texto é lido SEM comentários. A janela some como critério de segurança.
 */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // bloco
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // linha — o `[^:]` evita comer `https://`
}

// ── GUARDA 2: o TLS decidido para uma string, a conexão feita com outra ────
console.log('\nguarda 2 — TLS decidido para a string errada')
const descasados = []
for (const f of arquivos) {
  const rel = path.relative(RAIZ, f).replace(/\\/g, '/')
  if (DONOS.includes(rel)) continue
  const texto = semComentarios(fs.readFileSync(f, 'utf8'))
  // `connectionString: X` e `ssl: sslParaHost(Y)` na mesma expressão de objeto — o par
  // tem de citar a MESMA fonte. Sem comentários no caminho, 400 chars é folga de sobra.
  const re = /connectionString:\s*([A-Za-z_$][\w$.]*(?:\(\))?)[\s\S]{0,400}?ssl:\s*sslParaHost\(\s*([A-Za-z_$][\w$.]*(?:\(\))?)\s*\)/g
  for (const m of texto.matchAll(re)) {
    if (m[1] !== m[2]) descasados.push(`${rel}: connectionString=${m[1]} mas ssl=sslParaHost(${m[2]})`)
  }
}
afirmar('toda conexão decide o TLS pela própria string', descasados, [])

// ── GUARDA 3: conexão SEM decisão de TLS nenhuma ───────────────────────────
//
// Os guardas 1 e 2 olham para quem DECIDE errado. Ninguém olhava para quem não decide:
// `new pg.Pool({ connectionString: … })` sem a chave `ssl` — o node-pg assume SEM TLS.
// Funciona hoje, porque tudo passa pelo túnel em localhost; quebra no dia em que o
// pooler voltar a ser exposto num IP público, que é justamente o cenário que o cabeçalho
// do helper anuncia como reversível "sem tocar em script nenhum".
console.log('\nguarda 3 — conexão sem decisão de TLS')
const semDecisao = []
for (const f of arquivos) {
  const rel = path.relative(RAIZ, f).replace(/\\/g, '/')
  if (DONOS.includes(rel)) continue
  const texto = semComentarios(fs.readFileSync(f, 'utf8'))
  // O literal de objeto passado ao construtor, até o `}` que o fecha.
  for (const m of texto.matchAll(/new\s+(?:pg\.)?(?:Client|Pool)\s*\(\s*\{([^{}]*)\}/g)) {
    const corpo = m[1]
    if (/connectionString\s*:/.test(corpo) && !/\bssl\s*:/.test(corpo)) {
      semDecisao.push(`${rel}: ${m[0].replace(/\s+/g, ' ').slice(0, 72)}…`)
    }
  }
}
afirmar('nenhuma conexão sem decisão de TLS', semDecisao, [])

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou ? 1 : 0)
