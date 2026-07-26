// src/app/api/cadastro/route.ts — autocadastro PÚBLICO com TESTE GRÁTIS de 3 dias.
// Cria a conta (senha em bcrypt) no plano escolhido com status 'trial' e
// expira_em = hoje + 3 dias. O login é feito em seguida pelo cliente (NextAuth).
// Rota pública (rate-limitada pelo middleware).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { emailExiste, criarUsuario } from '@/lib/users'
import { planoPorId } from '@/lib/planos'
import { enviarBoasVindasTrial } from '@/lib/email'

export const runtime = 'nodejs'

const DIAS_TRIAL = 3

const Schema = z.object({
  nome: z.string().min(2, 'Informe seu nome').max(120),
  email: z.string().email('E-mail inválido'),
  senha: z.string().min(6, 'A senha precisa de ao menos 6 caracteres').max(72),
  plano: z.enum(['essencial', 'pro']),
  empresa: z.string().max(160).optional(),
  cnpj: z.string().max(20).optional(),
  telefone: z.string().max(40).optional(),
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
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
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
