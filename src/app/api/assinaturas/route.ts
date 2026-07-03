// src/app/api/assinaturas/route.ts — recebe a intenção de assinatura do checkout
// público. Cria uma pendência (sem cobrança/cartão). Rota PÚBLICA (rate-limitada
// pelo middleware). A cobrança será feita pelo gateway quando integrado.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { criarAssinatura } from '@/lib/assinaturas'
import { planoPorId } from '@/lib/planos'

export const runtime = 'nodejs'

const Schema = z.object({
  nome: z.string().min(1).max(120),
  email: z.string().email(),
  empresa: z.string().max(160).optional(),
  instituicao: z.string().max(160).optional(),
  cpfCnpj: z.string().max(20).optional(),
  telefone: z.string().max(40).optional(),
  endereco: z.string().max(240).optional(),
  plano: z.enum(['essencial', 'pro']),
  metodo: z.enum(['pix', 'cartao', 'boleto']).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const parsed = Schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos', detalhes: parsed.error.flatten() }, { status: 400 })
    const d = parsed.data
    const plano = planoPorId(d.plano)!
    const id = await criarAssinatura({
      nome: d.nome, email: d.email, empresa: d.empresa, instituicao: d.instituicao,
      cpf_cnpj: d.cpfCnpj, telefone: d.telefone, endereco: d.endereco,
      plano: d.plano, metodo: d.metodo, valor: plano.preco,
    })
    // Aqui, quando o gateway estiver integrado, iniciaríamos a cobrança/checkout
    // hospedado e retornaríamos a URL de pagamento. Por ora, registra a pendência.
    return NextResponse.json({ ok: true, id, mensagem: 'Recebemos sua solicitação. Nossa equipe entrará em contato para concluir a assinatura.' })
  } catch (e) {
    console.error('[assinaturas POST]', e)
    return NextResponse.json({ error: 'Erro ao registrar assinatura' }, { status: 500 })
  }
}
