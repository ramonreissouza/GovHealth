// src/lib/dados-cobranca.ts — os dados de cobrança de /assinar, numa regra só.
//
// A tela e as duas rotas que recebem o formulário (/api/assinaturas, para Pix e boleto,
// e /api/assinaturas/checkout, para cartão) validam com ESTE esquema. Antes cada uma
// tinha o seu, com tudo opcional menos nome e e-mail, e a nota fiscal dependia de alguém
// correr atrás do CPF/CNPJ depois do pagamento.
//
// Obrigatórios desde 05/10/2026: instituição, CPF ou CNPJ (com dígito verificador),
// telefone com DDD e endereço. Empresa continua opcional: quem assina com CPF pode não ter.
//
// Roda no navegador também (a tela valida antes de enviar), então só importa o que é
// seguro no cliente.

import { z } from 'zod'
import { soDigitos, validarCpfOuCnpj } from '@/lib/validators'

export const dadosCobrancaSchema = z.object({
  nome: z.string({ required_error: 'Informe o nome completo.' }).trim().min(2, 'Informe o nome completo.').max(120),
  email: z.string({ required_error: 'Informe um e-mail válido.' }).trim().email('Informe um e-mail válido.'),
  empresa: z.string().trim().max(160).optional(),
  instituicao: z.string({ required_error: 'Informe a instituição de trabalho.' }).trim().min(2, 'Informe a instituição de trabalho.').max(160),
  cpfCnpj: z.string({ required_error: 'Informe o CPF ou CNPJ, usado na nota fiscal.' }).trim().min(1, 'Informe o CPF ou CNPJ, usado na nota fiscal.').max(20)
    .refine(validarCpfOuCnpj, 'CPF ou CNPJ inválido. Confira os números.'),
  telefone: z.string({ required_error: 'Informe um telefone com DDD.' }).trim().min(1, 'Informe um telefone com DDD.').max(40)
    .refine((v) => { const n = soDigitos(v).length; return n >= 10 && n <= 13 }, 'Telefone inválido. Use DDD + número.'),
  endereco: z.string({ required_error: 'Informe o endereço completo: rua, número, cidade e UF.' }).trim().min(10, 'Informe o endereço completo: rua, número, cidade e UF.').max(240),
})

export type DadosCobranca = z.infer<typeof dadosCobrancaSchema>

/** A primeira mensagem de um erro de validação, para mostrar ao usuário. */
export function primeiraMensagem(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Dados inválidos.'
}
