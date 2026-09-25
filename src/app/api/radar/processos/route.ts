// src/app/api/radar/processos/route.ts — processos monitorados (auto-selecionados).
// GET: lista (com motivo_match). PATCH: fixar/silenciar/atribuir/prioridade.
// POST/DELETE: exceções manuais. Isolado por titular_id.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { conectorPublico } from '@/lib/radar/conectores'
import { compraPublica } from '@/lib/radar/comprasgov-publico.mjs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const rows = await query(
    `SELECT id, conector_id, cnpj, licitacao_id, titulo, uf, valor, responsavel, prioridade,
            status, origem, mutado, participando, participando_em, motivo_match, link_portal, atualizado_em
       FROM radar_processos
      WHERE titular_id = $1
      ORDER BY (prioridade = 'alta') DESC, atualizado_em DESC
      LIMIT 1000`,
    [t.titularId],
  )
  return NextResponse.json({ processos: rows })
}

export async function PATCH(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { id?: string; mutado?: boolean; prioridade?: string; responsavel?: string; status?: string; linkPortal?: string; participando?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const sets: string[] = []
  const params: unknown[] = [body.id, t.titularId]
  if (body.mutado != null) { params.push(body.mutado); sets.push(`mutado = $${params.length}`) }
  if (body.prioridade) { params.push(body.prioridade); sets.push(`prioridade = $${params.length}`) }
  if (body.responsavel !== undefined) { params.push(body.responsavel || null); sets.push(`responsavel = $${params.length}`) }
  if (body.status) { params.push(body.status); sets.push(`status = $${params.length}`) }
  if (body.linkPortal !== undefined) { params.push(body.linkPortal || null); sets.push(`link_portal = $${params.length}`) }
  // `participando_em` anda junto com a marca, na MESMA instrucao: uma coluna de data
  // escrita num segundo passo fica dessincronizada no primeiro erro de rede, e depois
  // ninguem sabe se a ausencia de data significa "nao marcou" ou "marcou e falhou".
  // Desmarcar zera a data — guardar quando alguem participou de algo que diz nao ter
  // participado nao serve a ninguem.
  if (body.participando != null) {
    params.push(body.participando)
    sets.push(`participando = $${params.length}`)
    sets.push(`participando_em = CASE WHEN $${params.length} THEN now() ELSE NULL END`)
  }
  if (!sets.length) return NextResponse.json({ error: 'nada a atualizar' }, { status: 400 })

  // "Estou participando" é informação comercialmente sensível — diz em que pregão a
  // empresa entrou, e a participação é sigilosa até a sessão. Mudá-la sem rastro deixava
  // sem resposta "quem desmarcou isto, e quando?". Por isso, quando ela vem no pedido,
  // a leitura do valor anterior, a atualização e a linha de auditoria são UMA instrução:
  // no Postgres, CTEs de escrita rodam na mesma transação implícita, então ou as três
  // acontecem ou nenhuma. Audita só quando o valor MUDA (duplo clique não vira ruído).
  let row: { id: string } | null
  if (body.participando != null) {
    params.push(t.userId)
    const pUser = params.length
    row = await queryOne<{ id: string }>(
      `WITH anterior AS (
         SELECT id, participando FROM radar_processos
          WHERE id = $1 AND titular_id = $2
          FOR UPDATE
       ), alterado AS (
         UPDATE radar_processos p SET ${sets.join(', ')}, atualizado_em = now()
           FROM anterior WHERE p.id = anterior.id
         RETURNING p.id, anterior.participando AS valor_antes, p.participando AS valor_depois
       ), auditoria AS (
         INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id, detalhe)
         SELECT $2, $${pUser}, 'participacao', 'radar_processos', id,
                jsonb_build_object('antes', valor_antes, 'depois', valor_depois)
           FROM alterado
          WHERE valor_antes IS DISTINCT FROM valor_depois
       )
       SELECT id FROM alterado`,
      params,
    )
  } else {
    row = await queryOne<{ id: string }>(
      `UPDATE radar_processos SET ${sets.join(', ')}, atualizado_em = now()
        WHERE id = $1 AND titular_id = $2 RETURNING id`,
      params,
    )
  }
  if (!row) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let body: { conectorId?: string; cnpj?: string; licitacaoId?: string; titulo?: string; uf?: string; linkPortal?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const cnpj = (body.cnpj ?? '').replace(/\D+/g, '')
  const conectorId = body.conectorId ?? 'comprasgov'
  const uf = (body.uf ?? '').trim().toUpperCase().slice(0, 2) || null
  // Em portal PÚBLICO, a licitação é o próprio objeto/título — não exige nº de controle
  // (quem adiciona à mão nem sempre tem o número em mãos). Era 'pcp' escrito na regra, e
  // por isso adicionar um processo do BLL/BNC à mão respondia 400 sem explicar por quê.
  const compra = conectorId === 'comprasgov' ? compraPublica(body.linkPortal) : null
  if (conectorId === 'comprasgov' && !compra) return NextResponse.json({ error: 'Cole o link público de acompanhamento da compra no Compras.gov.br, contendo ?compra= e os 17 dígitos da identificação.' }, { status: 400 })
  const licitacaoId = compra ? `comprasgov:publico:${compra.chave}` : (body.licitacaoId ?? '').trim() || (conectorPublico(conectorId) ? (body.titulo ?? '').trim().slice(0, 120) : '')
  if (!licitacaoId) return NextResponse.json({ error: 'licitacaoId (ou título) obrigatório' }, { status: 400 })
  const id = randomUUID()
  await query(
    `INSERT INTO radar_processos (id, titular_id, user_id, conector_id, cnpj, licitacao_id, titulo, uf, origem, link_portal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
     ON CONFLICT (titular_id, conector_id, cnpj, licitacao_id) DO UPDATE SET
       titulo = COALESCE(EXCLUDED.titulo, radar_processos.titulo),
       uf = COALESCE(EXCLUDED.uf, radar_processos.uf),
       link_portal = COALESCE(EXCLUDED.link_portal, radar_processos.link_portal),
       atualizado_em = now()`,
    [id, t.titularId, t.userId, conectorId, cnpj, licitacaoId, body.titulo ?? null, uf, compra?.url ?? body.linkPortal ?? null],
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  await query(`DELETE FROM radar_processos WHERE id = $1 AND titular_id = $2 AND origem = 'manual'`, [id, t.titularId])
  return NextResponse.json({ ok: true })
}
