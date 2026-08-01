// src/lib/planos.ts — planos de assinatura (fonte única: landing + checkout).
// 3 planos por decisão de produto:
//   • Essencial — núcleo de inteligência (1 usuário).
//   • Pro       — inteligência completa + workflow comercial (1 usuário).
//   • Empresa   — tudo do Pro + Radar de Chat (exclusivo) + equipe (vários
//                 usuários). Preço sob consulta → CTA "entrar em contato para
//                 orçamento" (não passa pelo checkout self-service).

import { CONTATO_EMAIL } from '@/lib/pix'

export interface Plano {
  id: 'essencial' | 'pro' | 'empresa'
  nome: string
  preco: number       // mensal, em BRL (0 quando `contato` — preço sob consulta)
  ciclo: string
  resumo: string
  destaque?: boolean
  /** Plano "sob consulta": mostra "Fale com vendas" em vez de checkout/preço. */
  contato?: boolean
  features: string[]
}

export const PLANOS: Plano[] = [
  {
    id: 'essencial',
    nome: 'Essencial',
    preco: 990,
    ciclo: 'mês',
    resumo: 'Para começar a antecipar as licitações de saúde.',
    features: [
      'Oportunidades do PNCP em tempo real',
      'Vencedores & Fornecedores',
      'Radar de Verba (emendas não executadas)',
      'Preços de referência (Compras.gov)',
      'Exportação Excel / CSV / PDF',
      'Alertas no navegador',
      '1 usuário · cobertura nacional',
    ],
  },
  {
    id: 'pro',
    nome: 'Pro',
    preco: 1990,
    ciclo: 'mês',
    resumo: 'Inteligência completa + workflow comercial.',
    destaque: true,
    features: [
      'Tudo do Essencial',
      'Concorrentes por UF & Breakdown de preços',
      'Meu Território (filtro multi-UF)',
      'Agenda de prazos com exportação .ics',
      'Dossiês de Edital',
      'Pipeline CRM',
      'Mapa de inteligência',
      'Portfólio & matching CATMAT',
      '1 usuário · suporte prioritário',
    ],
  },
  {
    id: 'empresa',
    nome: 'Empresa',
    preco: 0,
    ciclo: 'mês',
    resumo: 'Para equipes: tudo do Pro, Radar de Chat e vários usuários.',
    contato: true,
    features: [
      'Tudo do Pro',
      'Radar de Chat — monitor de chat de licitações (exclusivo)',
      'Equipe: vários usuários / assentos',
      'Gestão de acessos por CNPJ',
      'Onboarding e suporte dedicados',
    ],
  },
]

export const planoPorId = (id: string | null | undefined): Plano | undefined => PLANOS.find((p) => p.id === id)

export const formatarPreco = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })

/** Rótulo de preço para exibição — "Sob consulta" nos planos por contato. */
export const precoLabel = (p: Plano): string => (p.contato ? 'Sob consulta' : formatarPreco(p.preco))

/** E-mail de vendas + assunto pré-preenchido para o CTA de orçamento (plano Empresa). */
export const orcamentoHref = (nomePlano = 'Empresa'): string =>
  `mailto:${CONTATO_EMAIL}?subject=${encodeURIComponent(`Orçamento — Plano ${nomePlano} (GovHealth AI)`)}&body=${encodeURIComponent(
    `Olá! Tenho interesse no plano ${nomePlano} da GovHealth AI.\n\nEmpresa/CNPJ:\nNº de usuários desejado:\nTelefone/WhatsApp:\n\n(conte um pouco da sua operação para prepararmos a proposta)`,
  )}`
