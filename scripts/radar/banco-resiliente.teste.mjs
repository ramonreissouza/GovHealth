// scripts/radar/banco-resiliente.teste.mjs — o retry que impede a conexão caída de
// apagar a fila, e que NÃO pode esconder erro de verdade.
//
// Sem banco e sem relógio: a consulta é uma função que falha do jeito que pedimos, e a
// espera é registrada em vez de dormida.

import { comRetry, erroTransitorio, emTransacao } from './banco-resiliente.mjs'

let ok = 0, falhou = 0
function afirmar(nome, valor, esperado) {
  const bom = JSON.stringify(valor) === JSON.stringify(esperado)
  if (bom) { ok++; console.log(`  ok   ${nome}`) }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(valor)}`) }
}

const erro = (message, code) => Object.assign(new Error(message), code ? { code } : {})
const RESET = () => erro('read ECONNRESET', 'ECONNRESET')
// O que o pg lança quando o PgBouncer derruba a conexão no meio (visto no radar.log).
const TERMINADA = () => erro('Connection terminated unexpectedly')

/** Consulta falsa: falha com os erros da fila, depois responde. */
function consultaQueFalha(...erros) {
  const est = { chamadas: 0 }
  const fn = async () => {
    est.chamadas++
    const e = erros.shift()
    if (e) throw e()
    return { rows: [{ ok: true }] }
  }
  return { fn, est }
}

const esperas = []
const dormir = async (ms) => { esperas.push(ms) }

console.log('\nbanco-resiliente — o que é transitório\n')

afirmar('ECONNRESET é transitório', erroTransitorio(RESET()), true)
afirmar('"Connection terminated unexpectedly" é transitório', erroTransitorio(TERMINADA()), true)
afirmar('57P01 (PgBouncer reiniciando) é transitório', erroTransitorio(erro('terminating connection due to administrator command', '57P01')), true)
afirmar('08006 é transitório', erroTransitorio(erro('x', '08006')), true)
// Repetir estes não conserta nada — só atrasa e esconde o defeito.
afirmar('tabela inexistente NÃO é transitório', erroTransitorio(erro('relation "x" does not exist', '42P01')), false)
afirmar('violação de unicidade NÃO é transitório', erroTransitorio(erro('duplicate key value', '23505')), false)
afirmar('ON CONFLICT sem índice (42P10) NÃO é transitório', erroTransitorio(erro('there is no unique or exclusion constraint', '42P10')), false)
afirmar('null não é transitório', erroTransitorio(null), false)

console.log('\nbanco-resiliente — comRetry\n')

{
  const { fn, est } = consultaQueFalha(RESET)
  const r = await comRetry(fn, { dormir })
  afirmar('conexão caiu uma vez: a 2ª tentativa responde', r.rows[0].ok, true)
  afirmar('conexão caiu uma vez: 2 chamadas', est.chamadas, 2)
}

{
  esperas.length = 0
  const { fn, est } = consultaQueFalha(TERMINADA, RESET)
  const r = await comRetry(fn, { dormir })
  afirmar('caiu duas vezes: a 3ª responde', r.rows[0].ok, true)
  afirmar('caiu duas vezes: 3 chamadas', est.chamadas, 3)
  afirmar('espera cresce entre as tentativas', esperas, [500, 2000])
}

{
  const { fn, est } = consultaQueFalha(RESET, RESET, RESET, RESET)
  let capturado = null
  try { await comRetry(fn, { dormir }) } catch (e) { capturado = e }
  afirmar('banco fora do ar: desiste depois de 3', est.chamadas, 3)
  afirmar('banco fora do ar: o erro sobe (quem decide é o isolamento do run.mjs)', capturado?.code, 'ECONNRESET')
}

{
  const { fn, est } = consultaQueFalha(() => erro('relation "radar_x" does not exist', '42P01'))
  let capturado = null
  try { await comRetry(fn, { dormir }) } catch (e) { capturado = e }
  afirmar('erro de SQL: não repete', est.chamadas, 1)
  afirmar('erro de SQL: sobe intacto', capturado?.code, '42P01')
}

{
  const avisos = []
  const { fn } = consultaQueFalha(RESET)
  await comRetry(fn, { dormir, aoRepetir: (e, n) => avisos.push([e.code, n]) })
  afirmar('a repetição é avisada, não silenciosa', avisos, [['ECONNRESET', 1]])
}

console.log('\nbanco-resiliente — emTransacao (a mensagem e o alerta dela são uma coisa só)\n')

/**
 * Pool falso COM TRANSAÇÃO: escritas ficam num rascunho e só valem no COMMIT. `falharEm`
 * lista, por número de instrução (contando todas as conexões), onde a conexão cai.
 * `commitPerdido`: o COMMIT é aplicado, mas a resposta se perde (o caso "incerto").
 */
function poolFalso({ falharEm = [], commitPerdido = false } = {}) {
  const banco = { mensagens: new Map(), notificacoes: new Set() }
  const est = { instrucoes: 0, commits: 0, begins: 0, descartadas: 0 }
  let perdeuCommit = false
  const pool = {
    _banco: banco, _est: est,
    async connect() {
      let rascunho = null
      return {
        async query(sql, params = []) {
          est.instrucoes++
          if (falharEm.includes(est.instrucoes)) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
          if (sql === 'BEGIN') { est.begins++; rascunho = { m: [], n: [] }; return { rows: [] } }
          if (sql === 'ROLLBACK') { rascunho = null; return { rows: [] } }
          if (sql === 'COMMIT') {
            for (const [h, id] of rascunho.m) banco.mensagens.set(h, id)
            for (const n of rascunho.n) banco.notificacoes.add(n)
            rascunho = null
            est.commits++
            if (commitPerdido && !perdeuCommit) { perdeuCommit = true; throw Object.assign(new Error('Connection terminated unexpectedly'), {}) }
            return { rows: [] }
          }
          if (sql.startsWith('INSERT msg')) {
            const [hash] = params
            if (banco.mensagens.has(hash) || rascunho.m.some(([h]) => h === hash)) return { rows: [] }
            const id = banco.mensagens.size + rascunho.m.length + 1
            rascunho.m.push([hash, id])
            return { rows: [{ id }] }
          }
          if (sql.startsWith('INSERT notif')) { rascunho.n.push(params[0]); return { rows: [] } }
          throw new Error('sql inesperado: ' + sql)
        },
        release(erro) { if (erro) est.descartadas++ },
      }
    },
  }
  return pool
}

/** O que `gravarMensagens` faz por mensagem, com as mesmas decisões. */
const gravarUma = (hash) => async (db) => {
  const { rows: ins } = await db.query('INSERT msg', [hash])
  if (!ins.length) return false
  await db.query('INSERT notif', [`nm:${ins[0].id}:email`])
  await db.query('INSERT notif', [`nm:${ins[0].id}:app`])
  return true
}
const semEspera = { dormir: async () => {}, aoRepetir: () => {} }

// 1) O CASO DA REVISÃO: a conexão cai DEPOIS do INSERT da mensagem e ANTES do alerta.
//    Instrução 1 = BEGIN, 2 = INSERT msg, 3 = 1º INSERT notif ← cai aqui.
{
  const pool = poolFalso({ falharEm: [3] })
  const r = await emTransacao(pool, gravarUma('h1'), semEspera)
  afirmar('queda entre mensagem e alerta: a transação é refeita e grava', r, true)
  afirmar('queda entre mensagem e alerta: a mensagem está lá', pool._banco.mensagens.has('h1'), true)
  afirmar('queda entre mensagem e alerta: OS DOIS alertas estão lá', [...pool._banco.notificacoes].sort(), ['nm:1:app', 'nm:1:email'])
  afirmar('queda entre mensagem e alerta: a conexão quebrada é descartada do pool', pool._est.descartadas, 1)
}

// 2) Banco fora do ar até o fim das tentativas: NADA fica gravado — nem a mensagem.
//    É isso que permite à próxima passada recriar tudo. Comparado ao comportamento
//    antigo (instruções soltas), que deixava a mensagem órfã do alerta para sempre.
{
  const pool = poolFalso({ falharEm: [3, 7, 11] }) // cai no 1º alerta, nas 3 tentativas
  let erro = null
  try { await emTransacao(pool, gravarUma('h1'), semEspera) } catch (e) { erro = e }
  afirmar('queda persistente: o erro sobe', erro?.code, 'ECONNRESET')
  afirmar('queda persistente: a mensagem NÃO fica gravada sozinha', pool._banco.mensagens.has('h1'), false)
  const r = await emTransacao(pool, gravarUma('h1'), semEspera) // a passada seguinte
  afirmar('passada seguinte: recria a mensagem', r, true)
  afirmar('passada seguinte: E o alerta', pool._banco.notificacoes.size, 2)

  // O comportamento antigo, para comparação: as mesmas instruções, sem transação.
  const velho = { mensagens: new Set(), notificacoes: new Set() }
  const soltas = async (hash, cai) => {
    if (velho.mensagens.has(hash)) return false // "já existia" — continue
    velho.mensagens.add(hash)
    if (cai) throw new Error('ECONNRESET')
    velho.notificacoes.add(`${hash}:email`)
    return true
  }
  await soltas('h1', true).catch(() => {})
  await soltas('h1', false)
  afirmar('O DEFEITO, sem transação: a mensagem fica e o alerta nunca é criado', [velho.mensagens.size, velho.notificacoes.size], [1, 0])
}

// 3) COMMIT INCERTO: o banco aplicou, a resposta se perdeu. Repetir encontra o hash e
//    para — sem duplicar, e com os alertas já gravados junto.
{
  const pool = poolFalso({ commitPerdido: true })
  const r = await emTransacao(pool, gravarUma('h1'), semEspera)
  afirmar('commit incerto: a repetição vê que já existe', r, false)
  afirmar('commit incerto: uma mensagem só', pool._banco.mensagens.size, 1)
  afirmar('commit incerto: alertas gravados junto com ela', pool._banco.notificacoes.size, 2)
}

// 4) Quem chamou já está numa transação (PoolClient, como o do transacaoPublica): não
//    abre outra — um BEGIN aninhado seria erro no Postgres.
{
  const pool = poolFalso()
  const client = await pool.connect()
  await client.query('BEGIN')
  await emTransacao(client, gravarUma('h1'), semEspera)
  afirmar('client em transação: não emite BEGIN de novo', pool._est.begins, 1)
  await client.query('COMMIT')
  afirmar('client em transação: a de fora é que confirma', pool._banco.mensagens.size, 1)
}

// 5) Erro de SQL não é repetido e não deixa nada pela metade.
{
  const pool = poolFalso()
  let n = 0
  let erro = null
  try {
    await emTransacao(pool, async (db) => {
      n++
      await db.query('INSERT msg', ['h1'])
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    }, semEspera)
  } catch (e) { erro = e }
  afirmar('erro de SQL: uma tentativa só', n, 1)
  afirmar('erro de SQL: sobe intacto', erro?.code, '23505')
  afirmar('erro de SQL: rollback, nada gravado', pool._banco.mensagens.size, 0)
  afirmar('erro de SQL: a conexão boa volta ao pool', pool._est.descartadas, 0)
}

console.log(`\n${ok} ok, ${falhou} falharam\n`)
process.exit(falhou ? 1 : 0)
