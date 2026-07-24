// src/app/api/radar/credenciais/route.ts — cofre de credenciais de portal do Radar.
// GET: metadados (NUNCA senha/storage_state). POST: cifra e grava. DELETE: remove.
// Isolado por titular_id (tenantDe). A decifração só acontece no worker de captura.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { cofreDisponivel } from '@/lib/radar/crypto'

export const runtime = 'nodejs'

/** Mascara o login: "joao@x.com" → "joa***". */
function mascarar(login: string): string {
  if (login.length <= 3) return login[0] + '***'
  return login.slice(0, 3) + '***'
}

export async function GET(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const rows = await query<{
    id: string; conector_id: string; cnpj: string; login: string; ativo: boolean; criado_em: string; conectado: boolean
    conexao_status: string; conexao_detalhe: string | null
    status: string | null; verificado_em: string | null; tentado_em: string | null; detalhe: string | null
  }>(
    `SELECT c.id, c.conector_id, c.cnpj, c.login, c.ativo, c.criado_em,
            (c.storage_state IS NOT NULL) AS conectado,
            c.conexao_status, c.conexao_detalhe,
            s.status, s.verificado_em, s.tentado_em, s.detalhe
       FROM radar_credenciais c
       LEFT JOIN radar_saude s ON s.credencial_id = c.id
      WHERE c.titular_id = $1
      ORDER BY c.criado_em DESC`,
    [t.titularId],
  )
  // Nunca devolve cred_cipher/storage_state; login vem mascarado.
  // `conectado` = já capturamos uma sessão do gov.br; `conexao` = fase do fluxo de conexão.
  return NextResponse.json({
    credenciais: rows.map((r) => ({
      id: r.id, conectorId: r.conector_id, cnpj: r.cnpj, login: mascarar(r.login), ativo: r.ativo,
      conectado: r.conectado,
      conexao: { status: r.conexao_status, detalhe: r.conexao_detalhe },
      criadoEm: r.criado_em,
      saude: { status: r.status ?? 'nunca_verificado', verificadoEm: r.verificado_em, tentadoEm: r.tentado_em, detalhe: r.detalhe },
    })),
  })
}

export async function POST(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  if (!cofreDisponivel()) {
    return NextResponse.json(
      { error: 'Cofre indisponível', instrucoes: 'Defina RADAR_CRED_KEY (32 bytes hex) no ambiente para armazenar a sessão com segurança.' },
      { status: 503 },
    )
  }
  // Modelo SEM SENHA: registra a conexão (CNPJ + identificação). O login acontece
  // na página real do gov.br via captura de sessão assistida (scripts/radar/connect.mjs),
  // que grava o storage_state cifrado depois. Aqui não recebemos/guardamos senha.
  let body: { conectorId?: string; cnpj?: string; login?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const conectorId = (body.conectorId ?? 'comprasgov').trim()
  const cnpj = (body.cnpj ?? '').replace(/\D+/g, '')
  const login = (body.login ?? '').trim()
  if (!cnpj || !login) return NextResponse.json({ error: 'CNPJ e identificação (CPF/login) são obrigatórios' }, { status: 400 })

  const novoId = randomUUID()
  // Não sobrescreve uma sessão já capturada (mantém storage_state ao reeditar rótulos).
  // RETURNING id devolve o id REAL — no conflito é o da linha existente, não o novo.
  const up = await queryOne<{ id: string }>(
    `INSERT INTO radar_credenciais (id, titular_id, user_id, conector_id, cnpj, login, metodo, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,'sessao', now())
     ON CONFLICT (titular_id, conector_id, cnpj) DO UPDATE
       SET login = EXCLUDED.login, ativo = true, atualizado_em = now()
     RETURNING id`,
    [novoId, t.titularId, t.userId, conectorId, cnpj, login],
  )
  const id = up?.id ?? novoId
  await query(
    `INSERT INTO radar_saude (credencial_id, titular_id, conector_id, status)
     VALUES ($1,$2,$3,'nunca_verificado')
     ON CONFLICT (credencial_id) DO NOTHING`,
    [id, t.titularId, conectorId],
  )
  await query(
    `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id, detalhe)
     VALUES ($1,$2,'cred_criada','radar_credenciais',$3,$4::jsonb)`,
    [t.titularId, t.userId, id, JSON.stringify({ conectorId, cnpj, metodo: 'sessao' })],
  )
  return NextResponse.json({ ok: true, id })
}

export async function DELETE(req: NextRequest) {
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  // Remove saúde + credencial (storage_state cifrado incluso). Só do próprio tenant.
  const cred = await queryOne<{ id: string }>(
    `SELECT id FROM radar_credenciais WHERE id = $1 AND titular_id = $2`, [id, t.titularId],
  )
  if (!cred) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })
  await query(`DELETE FROM radar_saude WHERE credencial_id = $1`, [id])
  await query(`DELETE FROM radar_credenciais WHERE id = $1 AND titular_id = $2`, [id, t.titularId])
  await query(
    `INSERT INTO radar_auditoria (titular_id, user_id, acao, entidade, entidade_id)
     VALUES ($1,$2,'cred_removida','radar_credenciais',$3)`,
    [t.titularId, t.userId, id],
  )
  return NextResponse.json({ ok: true })
}
