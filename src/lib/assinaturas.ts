// src/lib/assinaturas.ts — intenções de assinatura vindas do checkout público.
// A cobrança real é de um gateway (Asaas/Iugu/Pagar.me/Stripe) — aqui só a
// INTENÇÃO/pendência até a integração. NENHUM dado de cartão é armazenado.
import { query } from '@/lib/db'

export interface Assinatura {
  id: number; nome: string | null; email: string; empresa: string | null; instituicao: string | null
  cpf_cnpj: string | null; telefone: string | null; endereco: string | null
  plano: string; ciclo: string | null; metodo: string | null; valor: number | null
  status: string; criado_em: string
}

export async function criarAssinatura(d: {
  nome?: string; email: string; empresa?: string; instituicao?: string; cpf_cnpj?: string
  telefone?: string; endereco?: string; plano: string; metodo?: string; valor?: number
}): Promise<number> {
  const r = await query<{ id: number }>(
    `INSERT INTO assinaturas (nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,metodo,valor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [d.nome ?? null, d.email, d.empresa ?? null, d.instituicao ?? null, d.cpf_cnpj ?? null,
     d.telefone ?? null, d.endereco ?? null, d.plano, d.metodo ?? null, d.valor ?? null],
  )
  return r[0]?.id
}

export async function listarAssinaturas(limit = 100): Promise<Assinatura[]> {
  return query<Assinatura>(
    `SELECT id,nome,email,empresa,instituicao,cpf_cnpj,telefone,endereco,plano,ciclo,metodo,
            valor::float8 AS valor, status, to_char(criado_em,'YYYY-MM-DD"T"HH24:MI') AS criado_em
     FROM assinaturas ORDER BY criado_em DESC LIMIT ${Math.min(limit, 500)}`,
  )
}
