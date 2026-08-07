// src/app/api/ia/conversas/route.ts — histórico de conversas com a IA.
// GET    ?tipo=copiloto|edital        → lista as conversas do usuário (recentes 1o)
// POST   { tipo, titulo?, mensagens } → cria uma conversa com as mensagens iniciais
// Sempre escopado ao usuário logado (getToken) — nunca a outro.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { query } from '@/lib/db'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

const TIPOS = new Set(['copiloto', 'edital'])
const LIMITE_LISTA = 50

export async function userIdDe(req: NextRequest): Promise<string | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const id = (token?.id as string | undefined) ?? (token?.sub as string | undefined)
  return id ? id.toLowerCase() : null
}

/** Título a partir da 1a pergunta — é o que o usuário reconhece na lista. */
export function tituloDe(texto: string): string {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (!limpo) return 'Nova conversa'
  return limpo.length > 70 ? `${limpo.slice(0, 70)}…` : limpo
}

export async function GET(req: NextRequest) {
  const uid = await userIdDe(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const tipo = req.nextUrl.searchParams.get('tipo') ?? 'copiloto'
  if (!TIPOS.has(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })

  const conversas = await query<{ id: string; titulo: string; atualizado_em: string; n: number }>(
    `SELECT c.id, c.titulo, c.atualizado_em,
            (SELECT count(*)::int FROM ia_mensagens m WHERE m.conversa_id = c.id) AS n
       FROM ia_conversas c
      WHERE c.user_id = $1 AND c.tipo = $2
      ORDER BY c.atualizado_em DESC
      LIMIT ${LIMITE_LISTA}`,
    [uid, tipo],
  )
  return NextResponse.json({ conversas })
}

export async function POST(req: NextRequest) {
  const uid = await userIdDe(req)
  if (!uid) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const tipo = body?.tipo
  if (!TIPOS.has(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })

  const mensagens: Array<{ papel: string; conteudo?: string; dados?: unknown }> =
    Array.isArray(body?.mensagens) ? body.mensagens : []
  const primeiraDoUsuario = mensagens.find((m) => m.papel === 'user')?.conteudo ?? ''
  const id = randomUUID()

  await query(
    `INSERT INTO ia_conversas (id, user_id, tipo, titulo) VALUES ($1,$2,$3,$4)`,
    [id, uid, tipo, body?.titulo?.trim() || tituloDe(primeiraDoUsuario)],
  )
  for (const m of mensagens) {
    await query(
      `INSERT INTO ia_mensagens (conversa_id, papel, conteudo, dados) VALUES ($1,$2,$3,$4::jsonb)`,
      [id, m.papel === 'assistant' ? 'assistant' : 'user', m.conteudo ?? '',
       m.dados == null ? null : JSON.stringify(m.dados)],
    )
  }
  return NextResponse.json({ id })
}
