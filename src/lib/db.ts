// src/lib/db.ts — cliente Postgres compartilhado (Neon em dev, Postgres próprio
// na VPS em produção).
// Pool lazy: não instancia no import, para o build não exigir DATABASE_URL.

import { Pool, types, type QueryResultRow } from 'pg'

// DATE (OID 1082) como string 'YYYY-MM-DD' — evita conversão de fuso que
// desloca o dia (ex.: expira_em de trial). Alinha com os tipos que já tratam
// datas como string (to_char nas demais queries).
types.setTypeParser(1082, (v) => v)

let pool: Pool | null = null

// Neon exige SSL. O Postgres da VPS (deploy/app/docker-compose.yml, host `db`) não
// tem TLS — e não precisa: essa conexão nunca sai da rede interna do compose, só o
// nginx termina HTTPS pra fora. Exigir SSL contra um Postgres sem TLS não degrada,
// FALHA a conexão inteira ("the server does not support SSL connections"), então
// isto não pode ser um default único — decide pelo host da própria connection string.
function sslParaHost(connectionString: string): false | { rejectUnauthorized: boolean } {
  let host = ''
  try { host = new URL(connectionString).hostname } catch { /* connectionString malformada: cai pro default (SSL) abaixo */ }
  const semTls = host === 'db' || host === 'localhost' || host === '127.0.0.1'
  return semTls ? false : { rejectUnauthorized: false }
}

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL não configurada — defina a connection string do banco no .env.local')
    }
    pool = new Pool({
      connectionString,
      ssl: sslParaHost(connectionString),
      max: 5,
      connectionTimeoutMillis: 5000,
    })
  }
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as never[])
  return res.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

// ── Health (src/app/api/health) ──────────────────────────────────────────────
// Pool próprio, com UMA conexão. A rota é pública: se usasse o pool acima, pedidos
// repetidos com o banco travado ocupariam as 5 conexões do app e derrubariam as
// rotas normais junto. Aqui, no pior caso, o health ocupa uma conexão a mais.
//
// O teto vale em cada etapa, dentro do próprio `pg`, e não num Promise.race por
// fora (que devolve o 503 mas deixa a consulta presa): esperar vaga no pool e abrir
// a conexão (`connectionTimeoutMillis`), a consulta no cliente (`query_timeout`) e
// no servidor (`statement_timeout`). Um cliente que estourou é destruído, e não
// devolvido ao pool, para não ficar uma consulta pendurada na conexão.
export function criarPingBanco(connectionString: string, tetoMs: number) {
  const poolPing = new Pool({
    connectionString,
    ssl: sslParaHost(connectionString),
    max: 1,
    connectionTimeoutMillis: tetoMs,
    query_timeout: tetoMs,
    statement_timeout: tetoMs,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  })
  // Uma conexão ociosa que cai (banco reiniciou) emite 'error' no pool; sem
  // listener, o Node derruba o processo inteiro.
  poolPing.on('error', () => {})

  async function ping(): Promise<void> {
    const cliente = await poolPing.connect()
    let falha: unknown
    try {
      await cliente.query('select 1')
    } catch (e) {
      falha = e
    }
    cliente.release(falha ? true : undefined)
    if (falha) throw falha
  }

  return { ping, pool: poolPing }
}

let pingBancoPadrao: ReturnType<typeof criarPingBanco> | null = null

/** `select 1` com teto de `tetoMs` em cada etapa. Lança se o banco não respondeu. */
export async function pingBanco(tetoMs = 1500): Promise<void> {
  if (!pingBancoPadrao) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL não configurada')
    pingBancoPadrao = criarPingBanco(connectionString, tetoMs)
  }
  await pingBancoPadrao.ping()
}
