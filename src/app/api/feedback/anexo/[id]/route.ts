// src/app/api/feedback/anexo/[id]/route.ts — serve o conteúdo de um anexo do backlog.
// Somente MASTER (mesma regra do GET do backlog). Servido como ANEXO (download) com
// CSP/sandbox e nosniff: o arquivo é enviado por QUALQUER usuário logado e aberto pelo
// master — servir 'inline' permitiria conteúdo ativo (ex.: HTML/SVG) executar na sessão
// do admin. 'attachment' + "default-src 'none'; sandbox" neutraliza esse vetor.

import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { exigirMaster } from '@/lib/admin-guard'
import { isAnexoMimePermitido } from '@/lib/feedback'

export const runtime = 'nodejs'

interface AnexoRow { nome: string; mime: string; dados: Buffer }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro

  const { id } = await params
  const rows = await query<AnexoRow>(
    `SELECT nome, mime, dados FROM feedback_anexos WHERE id = $1`, [id],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'anexo não encontrado' }, { status: 404 })

  const { nome, mime, dados } = rows[0]
  const tipo = isAnexoMimePermitido(mime) ? mime : 'application/octet-stream'
  // pg devolve bytea como Buffer; normaliza para um ArrayBuffer aceito pelo Response.
  const body = new Uint8Array(dados)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': tipo,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(nome)}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  })
}
