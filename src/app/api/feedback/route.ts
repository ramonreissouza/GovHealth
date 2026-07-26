// src/app/api/feedback/route.ts — backlog de "Reporte um problema".
//  POST   — qualquer usuário logado cria um issue (widget de chat).
//  GET     — MASTER lista o backlog (filtro opcional ?status=).
//  PATCH  — MASTER muda o status de um issue (gate de validação humana).
// A tabela feedback_issues é a fila que o agente de triagem/resolução consome (Fases 2-3).

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { randomUUID } from 'node:crypto'
import { query } from '@/lib/db'
import { exigirMaster } from '@/lib/admin-guard'
import {
  isFeedbackTipo, isFeedbackSeveridade, isFeedbackStatus,
  type FeedbackIssue, type FeedbackContexto, type FeedbackAnalise, type FeedbackSolucao,
} from '@/lib/feedback'
import { criarCardJira, comentarStatus } from '@/lib/jira'

export const runtime = 'nodejs'

interface TokenUser { id?: string; sub?: string; email?: string | null; name?: string | null; plano?: string | null; empresa?: string | null }

// ── Linha do banco → objeto camelCase da API ──────────────────────────────────
interface Row {
  id: string; criado_em: string; atualizado_em: string
  user_id: string | null; user_email: string | null; user_nome: string | null
  empresa: string | null; plano: string | null
  tipo: string; severidade: string; titulo: string; descricao: string
  contexto: FeedbackContexto; status: string
  analise: unknown; solucao: unknown; jira_key: string | null; resolvido_em: string | null
}
function toIssue(r: Row): FeedbackIssue {
  return {
    id: r.id, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
    userId: r.user_id, userEmail: r.user_email, userNome: r.user_nome,
    empresa: r.empresa, plano: r.plano,
    tipo: r.tipo as FeedbackIssue['tipo'], severidade: r.severidade as FeedbackIssue['severidade'],
    titulo: r.titulo, descricao: r.descricao, contexto: r.contexto ?? {},
    status: r.status as FeedbackIssue['status'],
    analise: (r.analise as FeedbackAnalise | null) ?? null,
    solucao: (r.solucao as FeedbackSolucao | null) ?? null,
    jiraKey: r.jira_key, resolvidoEm: r.resolvido_em,
  }
}

// ── POST: criar issue (usuário logado) ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const token = (await getToken({ req, secret: process.env.NEXTAUTH_SECRET })) as TokenUser | null
  if (!token) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: {
    tipo?: unknown; severidade?: unknown; titulo?: unknown; descricao?: unknown; contexto?: unknown
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }

  const titulo = String(body.titulo ?? '').trim()
  if (!titulo) return NextResponse.json({ error: 'Informe um título para o problema.' }, { status: 400 })

  const tipo = isFeedbackTipo(body.tipo) ? body.tipo : 'bug'
  const severidade = isFeedbackSeveridade(body.severidade) ? body.severidade : 'media'
  const descricao = String(body.descricao ?? '').trim().slice(0, 5000)
  const contexto: FeedbackContexto = (body.contexto && typeof body.contexto === 'object')
    ? (body.contexto as FeedbackContexto) : {}

  const id = randomUUID()
  const uid = (token.id ?? token.sub ?? null) as string | null
  await query(
    `INSERT INTO feedback_issues
       (id, user_id, user_email, user_nome, empresa, plano, tipo, severidade, titulo, descricao, contexto, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'novo')`,
    [id, uid, token.email ?? null, token.name ?? null, token.empresa ?? null, token.plano ?? null,
      tipo, severidade, titulo, descricao, JSON.stringify(contexto)],
  )

  // Espelha no Jira (Fase 4) — best-effort e INERTE sem credenciais; nunca falha o submit.
  try {
    const jiraKey = await criarCardJira({
      issueId: id, titulo, descricao, tipo, severidade,
      reporter: token.name ?? token.email ?? null, rota: contexto.rota ?? null,
    })
    if (jiraKey) await query(`UPDATE feedback_issues SET jira_key = $2 WHERE id = $1`, [id, jiraKey])
  } catch (e) { console.warn('[feedback] jira mirror falhou:', e) }

  return NextResponse.json({ ok: true, id })
}

// ── GET: backlog (master) ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro

  const status = req.nextUrl.searchParams.get('status') ?? undefined
  const where: string[] = []
  const params: unknown[] = []
  if (status && isFeedbackStatus(status)) { params.push(status); where.push(`status = $${params.length}`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await query<Row>(
    `SELECT * FROM feedback_issues ${whereSql} ORDER BY criado_em DESC LIMIT 500`, params,
  )
  const counts = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM feedback_issues GROUP BY status`,
  )
  return NextResponse.json({
    issues: rows.map(toIssue),
    contagem: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  })
}

// ── PATCH: mudar status (master — gate de validação) ──────────────────────────
export async function PATCH(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro

  let body: { id?: unknown; status?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const id = String(body.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  if (!isFeedbackStatus(body.status)) return NextResponse.json({ error: 'status inválido' }, { status: 400 })

  const resolvido = body.status === 'integrado' || body.status === 'rejeitado'
  const rows = await query<Row>(
    `UPDATE feedback_issues
       SET status = $2, atualizado_em = now(),
           resolvido_em = CASE WHEN $3 THEN now() ELSE resolvido_em END
     WHERE id = $1
     RETURNING *`,
    [id, body.status, resolvido],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'issue não encontrado' }, { status: 404 })

  // Espelha a mudança de status no Jira (best-effort/inerte).
  const issue = toIssue(rows[0])
  if (issue.jiraKey) {
    const extra = issue.solucao?.resumo ? `Solução: ${issue.solucao.resumo}` : undefined
    comentarStatus(issue.jiraKey, issue.status, extra).catch(() => {})
  }

  return NextResponse.json({ ok: true, issue })
}
