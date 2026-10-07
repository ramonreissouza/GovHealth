// Testes da observabilidade (TS-540): redação do que vai para o SigNoz, o corpo de
// /api/erro-cliente e o ping do /api/health com o banco travado.
// Roda com `npm run observabilidade:teste`. Não precisa de banco nem de SigNoz: os
// dois são servidores falsos abertos aqui.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { redigir, redigirAtributos } from '../src/lib/redigir.mjs'
import { lerErroCliente, normalizarMensagem, prepararErroCliente, TETO_CORPO } from '../src/lib/erro-cliente-servidor'
import { criarPingBanco } from '../src/lib/db'

const porta = (s: net.Server | http.Server) => (s.address() as net.AddressInfo).port
const ouvir = (s: net.Server | http.Server) => new Promise<void>((pronto) => s.listen(0, '127.0.0.1', pronto))
const esperar = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms))

// ── redação ──────────────────────────────────────────────────────────────────

test('query string e fragmento somem de URL e caminho, a linha:coluna da stack fica', () => {
  assert.equal(redigir('GET /api/opportunities?q=segredo&cnpj=12345678000190'), 'GET /api/opportunities')
  assert.equal(redigir('fetch GET https://pncp.gov.br/api/consulta?cnpj=1&pagina=1'), 'fetch GET https://pncp.gov.br/api/consulta')
  assert.equal(redigir('https://x.com?token=abc'), 'https://x.com')
  assert.equal(redigir('/redefinir-senha#token=abc'), '/redefinir-senha')
  assert.equal(
    redigir('at P (https://h/_next/static/chunks/page-1a2b.js?dpl=abc:1:2345)'),
    'at P (https://h/_next/static/chunks/page-1a2b.js:1:2345)',
  )
})

test('e-mail, CPF, celular, Bearer, JWT, par secreto e chave longa são trocados', () => {
  assert.equal(redigir('para fulano.silva@exemplo.com.br agora'), 'para [email] agora')
  assert.equal(redigir('123.456.789-09 12345678909 11987654321'), '[documento] [documento] [documento]')
  assert.equal(redigir('Authorization: Bearer abc.def'), 'Authorization: Bearer [token]')
  assert.equal(redigir('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln fim'), 'jwt [token] fim')
  assert.equal(redigir('senha=hunter2 token=xyz outro=ok'), 'senha=[redigido] token=[redigido] outro=ok')
  assert.equal(redigir('chave_7f3a9c2e81b4d6f05e1a9c3b7d2f8e46'), '[token]')
})

test('o que não é sensível passa intacto', () => {
  for (const t of [
    'select * from t where id = $1 limit 50',
    'idx_contratacoes_orgao_categoria',
    "Cannot read properties of undefined (reading 'map')",
    'at x (/app/.next/server/chunks/ssr/a.js:10:5)',
    'next@16.2.12 node_modules/@opentelemetry/api',
  ]) assert.equal(redigir(t), t)
})

test('atributos: url.query sai, o digest fica, strings e listas são redigidas', () => {
  assert.deepEqual(
    redigirAtributos({ 'url.query': 'a=b', 'erro.digest': '2262999834', 'http.target': '/x?q=1', l: ['/y?z=1', 2], n: 3 }),
    { 'erro.digest': '2262999834', 'http.target': '/x', l: ['/y', 2], n: 3 },
  )
})

// ── /api/erro-cliente ────────────────────────────────────────────────────────

const valido = { tipo: 'render', nome: 'TypeError', mensagem: 'x is undefined', rota: '/oportunidades?q=1' }

test('corpo que não é objeto JSON vira 400 (null, array, primitivos, JSON quebrado)', () => {
  for (const corpo of ['null', '[]', JSON.stringify([valido]), '42', '"texto"', 'true', '{', '', 'x'.repeat(TETO_CORPO + 1)]) {
    assert.equal(lerErroCliente(corpo), null, corpo.slice(0, 30))
  }
})

test('tipo fora da lista ou sem mensagem vira 400; nome e digest estranhos são descartados', () => {
  assert.equal(lerErroCliente(JSON.stringify({ ...valido, tipo: 'hack' })), null)
  assert.equal(lerErroCliente(JSON.stringify({ ...valido, mensagem: '' })), null)
  const r = lerErroCliente(JSON.stringify({ ...valido, nome: '<script>', digest: 'a b' }))
  assert.equal(r?.nome, 'Error')
  assert.equal(r?.digest, undefined)
  assert.equal(r?.rota, '/oportunidades')
})

test('sem sessão: só a mensagem normalizada, sem stack nem dado sensível', () => {
  const r = lerErroCliente(JSON.stringify({
    ...valido, mensagem: "falhou para fulano@exemplo.com no item 4521 ('Seringa 10ml')", stack: 'Error\n at /conta?token=abc',
  }))!
  const { excecao, atributos } = prepararErroCliente(r, false)
  assert.equal(excecao.stack, undefined)
  assert.equal(excecao.message, "falhou para [email] no item # ('…')")
  assert.equal(atributos['erro.sessao'], false)
  assert.equal(atributos['url.path'], '/oportunidades')
})

test('com sessão: mensagem e stack redigidas, não normalizadas', () => {
  const r = lerErroCliente(JSON.stringify({
    ...valido, mensagem: 'item 4521 falhou para fulano@exemplo.com', stack: 'Error\n at f (https://h/a.js?dpl=x:1:2)',
  }))!
  const { excecao } = prepararErroCliente(r, true)
  assert.equal(excecao.message, 'item 4521 falhou para [email]')
  assert.equal(excecao.stack, 'Error\n at f (https://h/a.js:1:2)')
})

test('o mesmo erro com números diferentes tem o mesmo fingerprint', () => {
  const a = prepararErroCliente(lerErroCliente(JSON.stringify({ ...valido, mensagem: 'item 1 falhou' }))!, false)
  const b = prepararErroCliente(lerErroCliente(JSON.stringify({ ...valido, mensagem: 'item 999 falhou' }))!, true)
  assert.equal(a.atributos['erro.fingerprint'], b.atributos['erro.fingerprint'])
  assert.equal(normalizarMensagem('item 999 falhou'), 'item # falhou')
})

// ── /api/health com o banco travado ──────────────────────────────────────────

/**
 * Servidor que aceita a conexão e nunca responde: o banco que não termina o handshake.
 * O `resume` importa: um socket que nunca lê o que recebeu não emite `close` nem
 * quando o outro lado fecha, e o teste veria uma conexão "presa" que não existe.
 */
async function bancoMudo() {
  const abertos = new Set<net.Socket>()
  const servidor = net.createServer((s) => { abertos.add(s); s.resume(); s.on('close', () => abertos.delete(s)) })
  await ouvir(servidor)
  return { servidor, abertos }
}

/** Servidor que completa o login do Postgres e depois ignora toda consulta. */
async function bancoQueTrava() {
  const abertos = new Set<net.Socket>()
  const servidor = net.createServer((s) => {
    abertos.add(s)
    s.on('close', () => abertos.delete(s))
    s.once('data', () => {
      s.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0])) // AuthenticationOk
      s.write(Buffer.from([0x5a, 0, 0, 0, 5, 0x49])) // ReadyForQuery
    })
  })
  await ouvir(servidor)
  return { servidor, abertos }
}

// Quando o primeiro cliente estoura o teto, o pool ainda abre uma tentativa para a
// fila e a derruba no próprio teto. Por isso a conferência espera 3 tetos: uma
// conexão pode viver até 2, nunca além.
test('banco mudo: pedidos simultâneos dão erro no teto e nenhuma conexão fica presa', async () => {
  const { servidor, abertos } = await bancoMudo()
  const { ping, pool } = criarPingBanco(`postgres://u:p@127.0.0.1:${porta(servidor)}/x`, 300)
  try {
    const inicio = Date.now()
    const resultados = await Promise.allSettled(Array.from({ length: 5 }, () => ping()))
    assert.ok(resultados.every((r) => r.status === 'rejected'))
    assert.ok(Date.now() - inicio < 1500, `levou ${Date.now() - inicio} ms`)
    assert.ok(abertos.size <= 1, `${abertos.size} conexões abertas ao mesmo tempo, com max: 1`)
    await esperar(900)
    assert.equal(pool.totalCount, 0)
    assert.equal(pool.waitingCount, 0)
    assert.equal(abertos.size, 0, 'o socket com o banco ficou aberto')
  } finally {
    await pool.end()
    servidor.close()
  }
})

test('consulta travada: erro no teto, o cliente é destruído e a conexão fecha', async () => {
  const { servidor, abertos } = await bancoQueTrava()
  const { ping, pool } = criarPingBanco(`postgres://u:p@127.0.0.1:${porta(servidor)}/x`, 300)
  try {
    const inicio = Date.now()
    await assert.rejects(ping())
    assert.ok(Date.now() - inicio < 1500, `levou ${Date.now() - inicio} ms`)
    await esperar(300)
    assert.equal(pool.totalCount, 0, 'o cliente voltou ao pool com a consulta pendurada')
    assert.equal(abertos.size, 0, 'o socket com o banco ficou aberto')
  } finally {
    await pool.end()
    servidor.close()
  }
})

// ── exportador, de ponta a ponta ─────────────────────────────────────────────

/**
 * Roda o filho com o bootstrap real do worker apontando para um coletor OTLP falso
 * e devolve tudo o que chegou a ele, cru.
 */
async function exportadoPeloFilho(env: Record<string, string> = {}): Promise<string> {
  const corpos: string[] = []
  const coletor = http.createServer((req, res) => {
    let corpo = ''
    req.on('data', (c) => { corpo += c })
    req.on('end', () => { corpos.push(corpo); res.setHeader('content-type', 'application/json'); res.end('{}') })
  })
  await ouvir(coletor)
  try {
    const filho = spawn(process.execPath, ['--import', './src/worker/otel.mjs', 'scripts/observabilidade.filho.teste.mjs'], {
      env: { ...process.env, ...env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${porta(coletor)}`, OTEL_SERVICE_NAME: 'teste' },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    assert.equal(await new Promise((fim) => filho.on('exit', fim)), 0)
  } finally {
    coletor.close()
  }
  return corpos.join('\n')
}

/** Postgres falso que aceita o login e responde toda query com erro, na hora. */
async function bancoQueRecusa() {
  const campo = (tipo: string, valor: string) => Buffer.concat([Buffer.from(tipo), Buffer.from(valor), Buffer.from([0])])
  const corpoErro = Buffer.concat([campo('S', 'ERROR'), campo('C', 'XX000'), campo('M', 'banco falso'), Buffer.from([0])])
  const erro = Buffer.alloc(5); erro.write('E'); erro.writeInt32BE(4 + corpoErro.length, 1)
  const pronto = Buffer.from([0x5a, 0, 0, 0, 5, 0x49])
  const servidor = net.createServer((s) => {
    let logado = false
    s.on('data', (msg) => {
      if (!logado) { logado = true; s.write(Buffer.concat([Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]), pronto])); return }
      if (msg[0] === 0x58) { s.end(); return } // Terminate, do pool.end()
      s.write(Buffer.concat([erro, corpoErro, pronto]))
    })
  })
  await ouvir(servidor)
  return servidor
}

test('nada depois de ? (nem e-mail) sai do processo, em span automático ou manual', async () => {
  const tudo = await exportadoPeloFilho()
  // Sem isto o teste passaria com o exportador desligado.
  assert.ok(tudo.includes('/busca'), 'o span do fetch não chegou')
  assert.ok(tudo.includes('/oportunidades'), 'o span manual não chegou')
  assert.ok(tudo.includes('[email]'), 'a exceção não chegou')
  for (const vazado of ['segredo', '12345678000190', 'fulano@exemplo.com', 'url.query']) {
    assert.ok(!tudo.includes(vazado), `"${vazado}" saiu para o coletor`)
  }
})

test('query solta (polling do pg-boss) não vira span; a do job vira; pool.connect nunca', async () => {
  const banco = await bancoQueRecusa()
  try {
    const tudo = await exportadoPeloFilho({ PG_FALSO_URL: `postgres://u:p@127.0.0.1:${porta(banco)}/x` })
    assert.ok(tudo.includes('job teste'), 'o span do job não chegou')
    assert.ok(tudo.includes('dentro-do-job'), 'a query dentro do job não virou span')
    assert.ok(!tudo.includes('fora-de-span'), 'a query solta virou span')
    assert.ok(!tudo.includes('pg-pool.connect') && !tudo.includes('"pg.connect"'), 'o connect virou span')
  } finally {
    banco.close()
  }
})
