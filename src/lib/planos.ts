// src/lib/planos.ts — planos de assinatura (fonte única: landing + checkout).
// Preços iniciais de referência de mercado (sales intelligence gov-saúde) —
// ajustáveis. 2 planos por decisão de produto.

export interface Plano {
  id: 'essencial' | 'pro'
  nome: string
  preco: number       // mensal, em BRL
  ciclo: string
  resumo: string
  destaque?: boolean
  features: string[]
}

export const PLANOS: Plano[] = [
  {
    id: 'essencial',
    nome: 'Essencial',
    preco: 490,
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
    preco: 990,
    ciclo: 'mês',
    resumo: 'Inteligência completa + workflow comercial da equipe.',
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
      'Até 5 usuários · suporte prioritário',
    ],
  },
]

export const planoPorId = (id: string | null | undefined): Plano | undefined => PLANOS.find((p) => p.id === id)

export const formatarPreco = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })
