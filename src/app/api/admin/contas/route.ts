// src/app/api/admin/contas/route.ts — lista e cria contas. Só master (defense-in-depth).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirMaster } from '@/lib/admin-guard'
import { listarUsuarios, criarUsuario, emailExiste, gerarSenhaTemporaria } from '@/lib/users'
import { registrarAudit } from '@/lib/admin-audit'
import { validarCPF, validarCNPJ, soDigitos } from '@/lib/validators'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  const { searchParams } = req.nextUrl
  try {
    const usuarios = await listarUsuarios({
      busca: searchParams.get('busca') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    })
    return NextResponse.json({ usuarios })
  } catch (e) {
    console.error('[admin/contas GET]', e)
    return NextResponse.json({ error: 'Erro ao listar contas' }, { status: 500 })
  }
}

const cpfOpc = z.string().max(20).optional().refine((v) => !v || validarCPF(v), 'CPF inválido').transform((v) => v ? soDigitos(v) : undefined)
const cnpjOpc = z.string().max(20).optional().refine((v) => !v || validarCNPJ(v), 'CNPJ inválido').transform((v) => v ? soDigitos(v) : undefined)

const CriarSchema = z.object({
  email: z.string().email(),
  nome: z.string().min(1).max(120).optional(),
  empresa: z.string().max(120).optional(),
  telefone: z.string().max(40).optional(),
  instituicao: z.string().max(160).optional(),
  endereco: z.string().max(240).optional(),
  cpf: cpfOpc,
  cnpj: cnpjOpc,
  plano: z.string().max(40).optional(),
  status_assinatura: z.string().max(40).optional(),
  expira_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const guard = await exigirMaster(req)
  if ('erro' in guard) return guard.erro
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = CriarSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos', detalhes: parsed.error.flatten() }, { status: 400 })
    const dados = parsed.data
    if (await emailExiste(dados.email)) return NextResponse.json({ error: 'Já existe uma conta com esse e-mail.' }, { status: 409 })

    const senhaTemporaria = gerarSenhaTemporaria()
    const usuario = await criarUsuario({ ...dados, senha: senhaTemporaria })
    await registrarAudit(String(guard.token.id ?? guard.token.email), 'criar_conta', usuario.id, { plano: usuario.plano })

    // A senha temporária é devolvida UMA vez ao admin (não fica armazenada em claro).
    return NextResponse.json({ usuario, senhaTemporaria })
  } catch (e) {
    console.error('[admin/contas POST]', e)
    return NextResponse.json({ error: 'Erro ao criar conta' }, { status: 500 })
  }
}
