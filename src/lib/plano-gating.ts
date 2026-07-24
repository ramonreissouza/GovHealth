// src/lib/plano-gating.ts
// Travamento de funções por plano (Essencial × Pro). Fonte de verdade das rotas
// Pro-only — espelha as features de planos.ts. Módulo PURO (sem DB/pg) para poder
// rodar no middleware (Edge) e no cliente (Sidebar).
//
// Essencial (núcleo): Dashboard, Licitações, Vencedores, Fornecedores, Radar de
// Verba, Preços de referência, Alertas, Perfil, Manual, Portfólio? (não — Pro).
// Pro adiciona as rotas abaixo. O trial respeita o plano escolhido (trial do Pro
// vê Pro; trial do Essencial vê só o Essencial). Master tem acesso total.

export const ROTAS_PRO: string[] = [
  '/radar',
  '/concorrentes',
  '/concorrentes-estado',
  '/breakdown',
  '/mapa',
  '/crm',
  '/agenda',
  '/editais',
  '/portfolio',
  '/equipe',
]

export function ehRotaPro(pathname: string): boolean {
  return ROTAS_PRO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/**
 * Acesso Pro: master ou plano 'pro' (inclusive durante o trial do Pro). O trial do
 * Essencial NÃO libera as rotas Pro — vale o plano escolhido, não o status trial.
 */
export function temAcessoPro(ctx: { plano?: string | null; role?: string | null; status?: string | null }): boolean {
  if (ctx.role === 'master') return true
  return ctx.plano === 'pro'
}
