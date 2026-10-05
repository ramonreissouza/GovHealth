// src/lib/plano-gating.ts
// Travamento de funções por plano (Essencial × Pro × Empresa). Fonte de verdade
// das rotas travadas — espelha as features de planos.ts. Módulo PURO (sem DB/pg)
// para poder rodar no middleware (Edge) e no cliente (Sidebar).
//
// Essencial (núcleo): Dashboard, Licitações, Vencedores, Fornecedores, Radar de
// Verba, Preços de referência, Alertas, Perfil, Manual.
// Pro adiciona as ROTAS_PRO. Empresa adiciona, além do Pro, as ROTAS_EMPRESA
// (Radar de Chat + Equipe/vários usuários). O trial respeita o plano escolhido.
// Master tem acesso total.

export const ROTAS_PRO: string[] = [
  '/concorrentes',
  '/concorrentes-estado',
  '/breakdown',
  '/mapa',
  '/crm',
  '/agenda',
  '/editais',
  '/portfolio',
]

// Exclusivas do Empresa: Radar de Chat e a gestão de equipe (vários usuários).
export const ROTAS_EMPRESA: string[] = [
  '/radar',
  '/equipe',
]

const casa = (rotas: string[], pathname: string): boolean =>
  rotas.some((r) => pathname === r || pathname.startsWith(`${r}/`))

export function ehRotaPro(pathname: string): boolean {
  return casa(ROTAS_PRO, pathname)
}

export function ehRotaEmpresa(pathname: string): boolean {
  return casa(ROTAS_EMPRESA, pathname)
}

/**
 * Acesso Pro: master, plano 'pro' ou 'empresa' (Empresa ⊇ Pro). Inclui o trial do
 * Pro. O trial do Essencial NÃO libera as rotas Pro — vale o plano, não o status.
 */
export function temAcessoPro(ctx: { plano?: string | null; role?: string | null; status?: string | null }): boolean {
  if (ctx.role === 'master') return true
  return ctx.plano === 'pro' || ctx.plano === 'empresa'
}

/** Acesso Empresa (Radar de Chat + Equipe): master ou plano 'empresa'. */
export function temAcessoEmpresa(ctx: { plano?: string | null; role?: string | null; status?: string | null }): boolean {
  if (ctx.role === 'master') return true
  return ctx.plano === 'empresa'
}

/**
 * A conta pode usar recurso que gasta (IA)? O middleware só trava PÁGINAS para trial
 * vencido; uma API cara precisa conferir por conta própria.
 *
 * Bloqueia: teste grátis vencido, assinatura cancelada ou expirada. `inadimplente`
 * passa: é o período em que o Stripe ainda tenta cobrar, e o resto do app também
 * não trava nele. Master passa sempre.
 */
export function assinaturaPermiteUso(
  ctx: { role?: string | null; status?: string | null; expiraEm?: string | null },
  hojeIso: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (ctx.role === 'master') return true
  if (ctx.status === 'cancelada' || ctx.status === 'expirada') return false
  if (ctx.status === 'trial' && typeof ctx.expiraEm === 'string' && ctx.expiraEm.slice(0, 10) < hojeIso) return false
  return true
}
