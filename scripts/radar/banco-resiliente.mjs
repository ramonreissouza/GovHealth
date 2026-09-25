// scripts/radar/banco-resiliente.mjs — o que fazer quando a conexão cai NO MEIO de uma
// consulta, e não com ela parada no pool.
//
// O `banco.on('error')` do run.mjs cobre só a conexão OCIOSA: o pool descarta a morta e
// abre outra na próxima consulta. Uma consulta EM CURSO que leva ECONNRESET não passa
// por ali — a promise rejeita, sobe até o catch global e a passada, que é sequencial,
// termina com todos os conectores seguintes sem vez. Era o mesmo apagão de antes, só
// que por outra porta.
//
// Duas defesas, e as duas são necessárias:
//   1. `comRetry` repete, poucas vezes, SÓ o que é idempotente (leitura e upsert). A
//      segunda tentativa já pega uma conexão nova do pool.
//   2. o run.mjs isola cada conector num try/catch — o que ainda assim falhar derruba
//      aquele conector, não a fila.
//
// POR QUE NÃO REPETIR INSTRUÇÃO SOLTA. `gravarMensagens` decide se notifica pelo
// RETURNING do INSERT … ON CONFLICT DO NOTHING. Com as instruções soltas, uma queda
// DEPOIS do INSERT da mensagem e ANTES das notificações deixava a mensagem gravada e o
// alerta não: a rodada seguinte achava o `msg_hash`, passava por "já existia", e o
// cliente NUNCA recebia o alerta — em silêncio (revisão da #34, 2ª rodada).
//
// A saída é `emTransacao`: a mensagem, as notificações e a auditoria dela entram JUNTAS
// ou não entram. Aí repetir é seguro — se o COMMIT se perdeu na volta mas aconteceu,
// tudo já está lá (a repetição só encontra o hash); se não aconteceu, tudo é refeito.

// Códigos de "a conexão sumiu", não de "a consulta está errada". Erro de SQL, de
// permissão ou de constraint NÃO entra: repetir não conserta, só esconde.
const CODIGOS_TRANSITORIOS = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  '57P01', // admin_shutdown — PgBouncer/Postgres reiniciando
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', '08001', '08003', '08004', '08006', // connection_exception e família
])

const MENSAGENS_TRANSITORIAS =
  /connection terminated|terminating connection|connection error|server closed the connection|timeout exceeded when trying to connect/i

export function erroTransitorio(e) {
  if (!e) return false
  if (CODIGOS_TRANSITORIOS.has(e.code)) return true
  return MENSAGENS_TRANSITORIAS.test(String(e.message ?? ''))
}

const dormirReal = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Roda `fn` e repete em erro transitório de conexão. Use SÓ em operação idempotente.
 * @param {() => Promise<T>} fn
 * @param {{ tentativas?: number, esperasMs?: number[], dormir?: (ms:number)=>Promise<void>, aoRepetir?: (e:Error, n:number)=>void }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export async function comRetry(fn, { tentativas = 3, esperasMs = [500, 2000], dormir = dormirReal, aoRepetir } = {}) {
  let ultimo
  for (let n = 1; n <= tentativas; n++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      if (!erroTransitorio(e) || n === tentativas) throw e
      aoRepetir?.(e, n)
      await dormir(esperasMs[Math.min(n - 1, esperasMs.length - 1)] ?? 0)
    }
  }
  throw ultimo
}

/**
 * Roda `fn(client)` numa transação própria, repetindo a transação INTEIRA em erro de
 * conexão. `fn` recebe o client e deve devolver o resultado; efeitos fora do banco
 * (contadores, mapas) ficam com quem chamou, DEPOIS do retorno — dentro de `fn` eles
 * seriam contados duas vezes numa repetição.
 *
 * Se `banco` já é um client em transação de quem chamou (tem `release`: é um PoolClient,
 * como o do `transacaoPublica`), não abre outra — a atomicidade já é a da transação de
 * fora. Só um Pool (tem `connect` e não `release`) ganha transação própria.
 */
export async function emTransacao(banco, fn, opts = {}) {
  if (typeof banco?.release === 'function' || typeof banco?.connect !== 'function') return fn(banco)
  return comRetry(async () => {
    const client = await banco.connect()
    let quebrou = null
    try {
      await client.query('BEGIN')
      const r = await fn(client)
      await client.query('COMMIT')
      return r
    } catch (e) {
      quebrou = e
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      // Conexão que caiu não volta para o pool: `release(erro)` a descarta.
      client.release(quebrou && erroTransitorio(quebrou) ? quebrou : undefined)
    }
  }, {
    aoRepetir: (e, n) => console.warn(`    (conexão caiu no meio da gravação — refazendo a transação, tentativa ${n + 1}: ${e?.code ?? e?.message ?? e})`),
    ...opts,
  })
}

/** `banco.query` com retry — atalho para as leituras e upserts do run.mjs. */
export function consultar(banco, sql, params) {
  return comRetry(() => banco.query(sql, params), {
    aoRepetir: (e, n) => console.warn(`    (conexão caiu no meio da consulta — tentativa ${n + 1}: ${e?.code ?? e?.message ?? e})`),
  })
}
