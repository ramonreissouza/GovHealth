// src/app/api/admin/contas/[id]/route.ts — edita/suspende e exclui (soft) uma conta.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirMaster } from '@/lib/admin-guard'
import { atualizarUsuario, excluirUsuario, buscarUsuario } from '@/lib/users'
import { registrarAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'

const PatchSchema = z.object({
  nome: z.string().max(120).optional(),
  empresa: z.string().max(120).optional(),
  telefone: z.string().max(40).optional(),
  plano: z.string().max(40).optional(),
  status_assinatura: z.string().max(40).optional(),
  expira_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  suspenso: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  const { id } = await params
  try {
    const alvo = await buscarUsuario(id)
    if (!alvo || alvo.deleted_at) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    if (alvo.role === 'master') return NextResponse.json({ error: 'A conta master não pode ser alterada por aqui.' }, { status: 403 })

    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos', detalhes: parsed.error.flatten() }, { status: 400 })

    await atualizarUsuario(id, parsed.data)
    const acao = parsed.data.suspenso === undefined ? 'editar_conta' : (parsed.data.suspenso ? 'suspender' : 'reativar')
    await registrarAudit(String(guard.token.id ?? guard.token.email), acao, id, parsed.data)
    return NextResponse.json({ usuario: await buscarUsuario(id) })
  } catch (e) {
    console.error('[admin/contas PATCH]', e)
    return NextResponse.json({ error: 'Erro ao atualizar conta' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  const { id } = await params
  try {
    const alvo = await buscarUsuario(id)
    if (!alvo || alvo.deleted_at) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    if (alvo.role === 'master') return NextResponse.json({ error: 'A conta master não pode ser excluída.' }, { status: 403 })

    // Re-confirmação: o corpo deve trazer o e-mail exato da conta (ação destrutiva).
    const body = await req.json().catch(() => ({}))
    if (String(body?.confirmarEmail ?? '').trim().toLowerCase() !== alvo.email.toLowerCase()) {
      return NextResponse.json({ error: 'Confirmação incorreta: digite o e-mail exato da conta.' }, { status: 400 })
    }

    await excluirUsuario(id) // soft delete (deleted_at) — nunca apaga a linha
    await registrarAudit(String(guard.token.id ?? guard.token.email), 'excluir_conta', id, { email: alvo.email })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/contas DELETE]', e)
    return NextResponse.json({ error: 'Erro ao excluir conta' }, { status: 500 })
  }
}
