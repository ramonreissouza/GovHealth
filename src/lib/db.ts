// src/lib/db.ts — cliente Postgres (Neon) compartilhado.
// Pool lazy: não instancia no import, para o build não exigir DATABASE_URL.

import { Pool, type QueryResultRow } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL não configurada — defina a connection string do Neon no .env.local')
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Neon exige SSL
      max: 5,
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
