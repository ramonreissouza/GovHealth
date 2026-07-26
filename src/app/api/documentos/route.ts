// src/app/api/documentos/route.ts — Cofre de Documentos/Certidões (habilitação).
// GET lista; POST cria; PATCH edita; DELETE remove. Isolado por titular_id (tenantDe).
// Datas em texto 'YYYY-MM-DD' (o cliente calcula o estado de validade). v1 híbrida:
// arquivo_url guarda um link externo — o upload real (blob) entra depois sem migração.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import { tenantDe } from '@/lib/radar/db'
import { TIPOS_DOC } from '@/lib/documentos'

export const runtime = 'nodejs'

// ⛔ DESATIVADO (a pedido, 2026-07-26). Todos os handlers respondem 503 enquanto o Cofre
//    de Documentos estiver desligado. Reativar = trocar COFRE_DESATIVADO para false
//    (e reverter Sidebar / página / cron alertas-email).
const COFRE_DESATIVADO = true
const respostaDesativado = () =>
  NextResponse.json({ error: 'Cofre de Documentos desativado' }, { status: 503 })

const TIPOS_VALIDOS = new Set(TIPOS_DOC.map((t) => t.key))
const SELECT_COLS = `id, tipo, nome, numero, orgao_emissor,
  to_char(emissao, 'YYYY-MM-DD') AS emissao, to_char(validade, 'YYYY-MM-DD') AS validade,
  sem_validade, arquivo_url, observacao, criado_em, atualizado_em`

interface Row {
  id: string; tipo: string; nome: string; numero: string | null; orgao_emissor: string | null
  emissao: string | null; validade: string | null; sem_validade: boolean; arquivo_url: string | null
  observacao: string | null; criado_em: string; atualizado_em: string
}
function toDoc(r: Row) {
  return {
    id: r.id, tipo: r.tipo, nome: r.nome, numero: r.numero, orgaoEmissor: r.orgao_emissor,
    emissao: r.emissao, validade: r.validade, semValidade: r.sem_validade, arquivoUrl: r.arquivo_url,
    observacao: r.observacao, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em,
  }
}

// Normaliza um campo de data: '' → null; mantém 'YYYY-MM-DD'.
function data(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function texto(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, 500) : null
}

export async function GET(req: NextRequest) {
  if (COFRE_DESATIVADO) return respostaDesativado()
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const rows = await query<Row>(
    `SELECT ${SELECT_COLS} FROM documentos WHERE titular_id = $1
      ORDER BY sem_validade ASC, validade ASC NULLS LAST, nome ASC`,
    [t.titularId],
  )
  return NextResponse.json({ documentos: rows.map(toDoc) })
}

export async function POST(req: NextRequest) {
  if (COFRE_DESATIVADO) return respostaDesativado()
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }

  const tipo = String(b.tipo ?? '').trim()
  const nome = String(b.nome ?? '').trim()
  if (!TIPOS_VALIDOS.has(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
  if (!nome) return NextResponse.json({ error: 'nome é obrigatório' }, { status: 400 })
  const semValidade = b.semValidade === true

  const id = randomUUID()
  await query(
    `INSERT INTO documentos (id, titular_id, user_id, tipo, nome, numero, orgao_emissor, emissao, validade, sem_validade, arquivo_url, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, t.titularId, t.userId, tipo, nome.slice(0, 200), texto(b.numero), texto(b.orgaoEmissor),
     data(b.emissao), semValidade ? null : data(b.validade), semValidade, texto(b.arquivoUrl), texto(b.observacao)],
  )
  const row = await queryOne<Row>(`SELECT ${SELECT_COLS} FROM documentos WHERE id = $1`, [id])
  return NextResponse.json({ ok: true, documento: row ? toDoc(row) : null })
}

export async function PATCH(req: NextRequest) {
  if (COFRE_DESATIVADO) return respostaDesativado()
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }

  const id = String(b.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  const dono = await queryOne<{ id: string }>(`SELECT id FROM documentos WHERE id = $1 AND titular_id = $2`, [id, t.titularId])
  if (!dono) return NextResponse.json({ error: 'não encontrado' }, { status: 404 })

  const tipo = String(b.tipo ?? '').trim()
  const nome = String(b.nome ?? '').trim()
  if (!TIPOS_VALIDOS.has(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
  if (!nome) return NextResponse.json({ error: 'nome é obrigatório' }, { status: 400 })
  const semValidade = b.semValidade === true

  await query(
    `UPDATE documentos SET tipo=$2, nome=$3, numero=$4, orgao_emissor=$5, emissao=$6,
            validade=$7, sem_validade=$8, arquivo_url=$9, observacao=$10, atualizado_em=now()
      WHERE id=$1 AND titular_id=$11`,
    [id, tipo, nome.slice(0, 200), texto(b.numero), texto(b.orgaoEmissor), data(b.emissao),
     semValidade ? null : data(b.validade), semValidade, texto(b.arquivoUrl), texto(b.observacao), t.titularId],
  )
  const row = await queryOne<Row>(`SELECT ${SELECT_COLS} FROM documentos WHERE id = $1`, [id])
  return NextResponse.json({ ok: true, documento: row ? toDoc(row) : null })
}

export async function DELETE(req: NextRequest) {
  if (COFRE_DESATIVADO) return respostaDesativado()
  const t = await tenantDe(req)
  if (!t) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  const del = await query(`DELETE FROM documentos WHERE id = $1 AND titular_id = $2`, [id, t.titularId])
  void del
  return NextResponse.json({ ok: true })
}
