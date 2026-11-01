// src/app/api/cadastro/route.ts — autocadastro PÚBLICO com TESTE GRÁTIS (DIAS_TESTE_GRATIS, em lib/planos).
// Cria a conta (senha em bcrypt) no plano escolhido com status 'trial' e
// expira_em = hoje + DIAS_TESTE_GRATIS. O login é feito em seguida pelo cliente (NextAuth).
// Rota pública (rate-limitada pelo middleware).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { emailExiste, criarUsuario, senhaForteOk, registrarAceiteUsuario } from '@/lib/users'
import { planoPorId, DIAS_TESTE_GRATIS } from '@/lib/planos'
import { enviarBoasVindasTrial } from '@/lib/email'
import { camposAceite, erroDeAceite, ipDaRequisicao } from '@/lib/assinaturas'

export const runtime = 'nodejs'

const DIAS_TRIAL = DIAS_TESTE_GRATIS

const Schema = z.object({
  nome: z.string().min(2, 'Informe seu nome').max(120),
  email: z.string().email('E-mail inválido'),
  senha: z.string().max(72).refine(senhaForteOk, 'A senha precisa ter ao menos 8 caracteres, com letras e números.'),
  plano: z.enum(['essencial', 'pro']),
  empresa: z.string().max(160).optional(),
  cnpj: z.string().max(20).optional(),
  telefone: z.string().max(40).optional(),
  // "Li e estou de acordo" obrigatório: sem ele (ou com versão antiga) não há conta.
  ...camposAceite,
})

function dataMais(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function POST(req: NextRequest) {
  try {
    const parsed = Schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: erroDeAceite(parsed.error) ?? parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
    }
    const d = parsed.data
    const email = d.email.trim().toLowerCase()

    if (await emailExiste(email)) {
      return NextResponse.json({ error: 'Já existe uma conta com este e-mail. Faça login.' }, { status: 409 })
    }

    const plano = planoPorId(d.plano)!
    const trialAte = dataMais(DIAS_TRIAL)
    await criarUsuario({
      email,
      nome: d.nome,
      senha: d.senha,
      role: 'user',
      empresa: d.empresa,
      cnpj: d.cnpj,
      telefone: d.telefone,
      plano: plano.id,
      status_assinatura: 'trial',
      expira_em: trialAte,
    })
    await registrarAceiteUsuario(email, { termosVersao: d.termosVersao, privacidadeVersao: d.privacidadeVersao, ip: ipDaRequisicao(req.headers) })

    // E-mail de boas-vindas do trial — best-effort, não bloqueia o cadastro.
    try {
      await enviarBoasVindasTrial({ email, nome: d.nome, plano: plano.id, expiraEm: trialAte })
    } catch (e) {
      console.warn('[cadastro] falha ao enviar boas-vindas:', e)
    }

    return NextResponse.json({ ok: true, plano: plano.id, trialAte, diasTrial: DIAS_TRIAL })
  } catch (e) {
    console.error('[cadastro POST]', e)
    return NextResponse.json({ error: 'Não foi possível criar a conta.' }, { status: 500 })
  }
}
