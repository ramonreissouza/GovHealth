// src/app/api/cadastro/route.ts — autocadastro PÚBLICO com TESTE GRÁTIS (DIAS_TESTE_GRATIS, em lib/planos).
// Cria a conta (senha em bcrypt) no plano escolhido com status 'trial' e
// expira_em = hoje + DIAS_TESTE_GRATIS. O login é feito em seguida pelo cliente (NextAuth).
// Rota pública (rate-limitada pelo middleware).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { emailExiste, criarUsuario, senhaForteOk } from '@/lib/users'
import { planoPorId, DIAS_TESTE_GRATIS } from '@/lib/planos'
import { enviarBoasVindasTrial } from '@/lib/email'
import { camposAceite, erroDeAceite, ipDaRequisicao } from '@/lib/assinaturas'
import { validarCpfOuCnpj, soDigitos } from '@/lib/validators'

export const runtime = 'nodejs'

const DIAS_TRIAL = DIAS_TESTE_GRATIS

const Schema = z.object({
  nome: z.string().min(2, 'Informe seu nome').max(120),
  email: z.string().email('E-mail inválido'),
  senha: z.string().max(72).refine(senhaForteOk, 'A senha precisa ter ao menos 8 caracteres, com letras e números.'),
  plano: z.enum(['essencial', 'pro']),
  // Todos obrigatórios: o teste é B2B e o cadastro identifica a empresa (mesma regra da tela).
  telefone: z.string({ required_error: 'Informe um telefone com DDD.' }).max(40).refine((v) => [10, 11].includes(soDigitos(v).length), 'Informe um telefone com DDD.'),
  empresa: z.string({ required_error: 'Informe a empresa ou instituição.' }).trim().min(2, 'Informe a empresa ou instituição.').max(160),
  cpfCnpj: z.string({ required_error: 'Informe um CPF ou CNPJ válido.' }).max(20).refine(validarCpfOuCnpj, 'Informe um CPF ou CNPJ válido.'),
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
      // CPF e CNPJ em colunas separadas: a equipe (assentos) é agrupada por CNPJ, e um
      // CPF na coluna cnpj juntaria contas que não são da mesma empresa.
      ...(soDigitos(d.cpfCnpj).length === 11 ? { cpf: d.cpfCnpj } : { cnpj: d.cpfCnpj }),
      telefone: d.telefone,
      plano: plano.id,
      status_assinatura: 'trial',
      expira_em: trialAte,
      // A prova do aceite vai no mesmo INSERT da conta: as duas nascem juntas ou nenhuma.
      aceite: { termosVersao: d.termosVersao, privacidadeVersao: d.privacidadeVersao, ip: ipDaRequisicao(req.headers) },
    })

    // E-mail de boas-vindas do trial — best-effort, não bloqueia o cadastro.
    try {
      await enviarBoasVindasTrial({ email, nome: d.nome, plano: plano.id, expiraEm: trialAte })
    } catch (e) {
      console.warn('[cadastro] falha ao enviar boas-vindas:', e)
    }

    return NextResponse.json({ ok: true, plano: plano.id, trialAte, diasTrial: DIAS_TRIAL })
  } catch (e) {
    // Dois envios simultâneos passam juntos pelo emailExiste; o segundo INSERT bate na PK.
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'Já existe uma conta com este e-mail. Faça login.' }, { status: 409 })
    }
    console.error('[cadastro POST]', e)
    return NextResponse.json({ error: 'Não foi possível criar a conta.' }, { status: 500 })
  }
}
