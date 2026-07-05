// src/lib/plano-gating.ts
// Travamento de funções por plano (Essencial × Pro). Fonte de verdade das rotas
// Pro-only — espelha as features de planos.ts. Módulo PURO (sem DB/pg) para poder
// rodar no middleware (Edge) e no cliente (Sidebar).
//
// Essencial (núcleo): Dashboard, Licitações, Vencedores, Fornecedores, Radar de
// Verba, Preços de referência, Alertas, Perfil, Manual, Portfólio? (não — Pro).
// Pro adiciona as rotas abaixo. Trial e master têm acesso total.

export const ROTAS_PRO: string[] = [
  '/concorrentes',
  '/concorrentes-estado',
  '/breakdown',
  '/mapa',
  '/crm',
  '/agenda',
  '/editais',
  '/portfolio',
  '/minhas-disputas',
]

export function ehRotaPro(pathname: string): boolean {
  return ROTAS_PRO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/** Acesso Pro: master, plano 'pro', ou trial (experimenta tudo). Essencial = limitado. */
export function temAcessoPro(ctx: { plano?: string | null; role?: string | null; status?: string | null }): boolean {
  if (ctx.role === 'master') return true
  if (ctx.status === 'trial') return true
  return ctx.plano === 'pro'
}
