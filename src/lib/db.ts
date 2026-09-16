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
