// scripts/transacao.teste.ts — emTransacao (src/lib/db.ts): tudo ou nada.
// Uso: npm run transacao:teste
// É o que impede o aceite de convite de deixar o membro criado com o convite pendente
// quando a escrita seguinte falha (revisão da #70). Cliente falso: não precisa de banco.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emTransacao, type ClienteTx } from '../src/lib/db'

function clienteFalso(opts: { falharEm?: string; rollbackFalha?: boolean } = {}) {
  const sql: string[] = []
  const soltas: (Error | boolean | undefined)[] = []
  const cliente: ClienteTx = {
    async query(text) {
      sql.push(text)
      if (opts.falharEm && text.startsWith(opts.falharEm)) throw Object.assign(new Error('falha simulada'), { code: '57P01' })
      if (text === 'ROLLBACK' && opts.rollbackFalha) throw new Error('conexão caiu')
      return { rows: text.startsWith('SELECT') ? [{ n: 1 }] : [] }
    },
    release(e) { soltas.push(e) },
  }
  return { cliente, sql, soltas }
}

test('sucesso: BEGIN, as escritas e COMMIT, e devolve o resultado', async () => {
  const { cliente, sql, soltas } = clienteFalso()
  const r = await emTransacao(cliente, async (tx) => {
    await tx.query('INSERT INTO usuarios ...')
    await tx.query('UPDATE convites ...')
    return (await tx.queryOne<{ n: number }>('SELECT 1'))?.n
  })
  assert.equal(r, 1)
  assert.deepEqual(sql, ['BEGIN', 'INSERT INTO usuarios ...', 'UPDATE convites ...', 'SELECT 1', 'COMMIT'])
  assert.deepEqual(soltas, [undefined])
})

test('falha ENTRE as duas escritas: ROLLBACK, nada de COMMIT, e o erro sobe', async () => {
  const { cliente, sql, soltas } = clienteFalso({ falharEm: 'UPDATE convites' })
  await assert.rejects(
    emTransacao(cliente, async (tx) => {
      await tx.query('INSERT INTO usuarios ...')
      await tx.query('UPDATE convites ...')
    }),
    /falha simulada/,
  )
  assert.deepEqual(sql, ['BEGIN', 'INSERT INTO usuarios ...', 'UPDATE convites ...', 'ROLLBACK'])
  assert.ok(!sql.includes('COMMIT'))
  assert.deepEqual(soltas, [undefined], 'a conexão volta ao pool uma vez, sã')
})

test('erro de regra dentro da função também desfaz o que já foi escrito', async () => {
  const { cliente, sql } = clienteFalso()
  await assert.rejects(emTransacao(cliente, async (tx) => {
    await tx.query('INSERT INTO usuarios ...')
    throw new Error('sem vagas')
  }), /sem vagas/)
  assert.equal(sql.at(-1), 'ROLLBACK')
})

test('se nem o ROLLBACK passa, a conexão volta marcada como quebrada e o erro original sobe', async () => {
  const { cliente, soltas } = clienteFalso({ falharEm: 'INSERT', rollbackFalha: true })
  await assert.rejects(emTransacao(cliente, async (tx) => { await tx.query('INSERT INTO usuarios ...') }), /falha simulada/)
  assert.equal(soltas.length, 1)
  assert.ok(soltas[0] instanceof Error, 'release(erro) faz o pool descartar a conexão')
})
