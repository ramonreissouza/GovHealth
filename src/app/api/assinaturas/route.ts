// src/app/api/assinaturas/route.ts — recebe a intenção de assinatura do checkout
// público. Cria uma pendência (sem cobrança/cartão). Rota PÚBLICA (rate-limitada
// pelo middleware). A cobrança será feita pelo gateway quando integrado.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { criarAssinatura, registrarAceite, ipDaRequisicao, erroDeAceite } from '@/lib/assinaturas'
import { planoPorId } from '@/lib/planos'
import { TERMOS_VERSAO, PRIVACIDADE_VERSAO } from '@/lib/empresa-legal'

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
  // O aceite é da versão VIGENTE: uma página aberta antes de o texto mudar manda a versão
  // antiga, e aceitar em nome de um texto que a pessoa não leu não vale como evidência.
  termosVersao: z.literal(TERMOS_VERSAO, { errorMap: () => ({ message: 'Os Termos de Uso foram atualizados. Recarregue a página e confira o aceite.' }) }),
  privacidadeVersao: z.literal(PRIVACIDADE_VERSAO, { errorMap: () => ({ message: 'A Política de Privacidade foi atualizada. Recarregue a página e confira o aceite.' }) }),
})

export async function POST(req: NextRequest) {
  try {
    const parsed = Schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: erroDeAceite(parsed.error) ?? 'Dados inválidos', detalhes: parsed.error.flatten() }, { status: 400 })
    const d = parsed.data
    const plano = planoPorId(d.plano)!
    const id = await criarAssinatura({
      nome: d.nome, email: d.email, empresa: d.empresa, instituicao: d.instituicao,
      cpf_cnpj: d.cpfCnpj, telefone: d.telefone, endereco: d.endereco,
      plano: d.plano, metodo: d.metodo, valor: plano.preco,
    })
    await registrarAceite(id, { termosVersao: d.termosVersao, privacidadeVersao: d.privacidadeVersao, ip: ipDaRequisicao(req.headers) })
    // Aqui, quando o gateway estiver integrado, iniciaríamos a cobrança/checkout
    // hospedado e retornaríamos a URL de pagamento. Por ora, registra a pendência.
    return NextResponse.json({ ok: true, id, mensagem: 'Recebemos sua solicitação. Nossa equipe entrará em contato para concluir a assinatura.' })
  } catch (e) {
    console.error('[assinaturas POST]', e)
    return NextResponse.json({ error: 'Erro ao registrar assinatura' }, { status: 500 })
  }
}
