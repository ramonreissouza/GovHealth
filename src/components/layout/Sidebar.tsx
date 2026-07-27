'use client'
// src/components/layout/Sidebar.tsx

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import {
  LayoutDashboard, Map, Bot, Users, GitBranch, Zap, BookOpen, BarChart3, TrendingDown, Kanban, Globe2, LogOut, Bell, Menu, X,
  Boxes, FileSearch, FileSignature, Trophy, PieChart, Layers, Store, CalendarClock, Flame, Lock, Swords, CreditCard, Radar,
} from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { contarNaoLidas } from '@/lib/alertas'
import { IA_HABILITADA } from '@/lib/features'
import { ehRotaPro, temAcessoPro } from '@/lib/plano-gating'
import { clearLocalData } from '@/lib/synced'

// Rotas que dependem de IA — ocultadas da navegação quando IA_HABILITADA é false.
const IA_HREFS = new Set(['/copiloto', '/edital'])

const NAV_STATIC = [
  {
    label: 'Principal',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard, badge: null as string | null },
      { href: '/oportunidades', label: 'Licitações', icon: Zap, badge: null as string | null },
      { href: '/analise', label: 'Maior Atuação', icon: BarChart3, badge: null as string | null },
      { href: '/mapa', label: 'Mapa', icon: Map, badge: null as string | null },
      { href: '/copiloto', label: 'Copiloto IA', icon: Bot, badge: 'IA' as string | null },
      { href: '/edital', label: 'Copiloto de Edital', icon: FileSearch, badge: 'IA' as string | null },
    ],
  },
  {
    label: 'Inteligência',
    items: [
      { href: '/vencedores', label: 'Vencedores', icon: Trophy, badge: 'novo' as string | null },
      { href: '/minhas-disputas', label: 'Minhas Disputas', icon: Swords, badge: 'novo' as string | null },
      { href: '/fornecedores', label: 'Fornecedores', icon: Store, badge: 'novo' as string | null },
      { href: '/concorrentes-estado', label: 'Concorrentes/UF', icon: PieChart, badge: 'novo' as string | null },
      { href: '/breakdown', label: 'Breakdown', icon: Layers, badge: 'novo' as string | null },
      { href: '/concorrentes', label: 'Concorrentes', icon: Users, badge: null as string | null },
      { href: '/timeline', label: 'Timeline', icon: GitBranch, badge: '3' as string | null },
      { href: '/precos', label: 'Preços Ref.', icon: TrendingDown, badge: null as string | null },
      { href: '/crm', label: 'Pipeline CRM', icon: Kanban, badge: null as string | null },
      { href: '/agenda', label: 'Agenda de Prazos', icon: CalendarClock, badge: null as string | null },
      // Dossiês de Edital desativado (a pedido). Reativar: descomentar a linha abaixo.
      // { href: '/editais', label: 'Dossiês de Edital', icon: FolderKanban, badge: null as string | null },
      { href: '/contratos', label: 'Contratos.gov', icon: FileSignature, badge: null as string | null },
      { href: '/estados', label: 'Portais Estaduais', icon: Globe2, badge: '27' as string | null },
      { href: '/radar-verba', label: 'Radar de Verba', icon: Flame, badge: 'novo' as string | null },
      { href: '/radar', label: 'Radar de Chat', icon: Radar, badge: 'novo' as string | null },
      { href: '/alertas', label: 'Alertas', icon: Bell, badge: null as string | null },
    ],
  },
  {
    label: 'Conta',
    items: [
      { href: '/perfil', label: 'Setup da Empresa', icon: Boxes, badge: null as string | null },
      // DESATIVADO (a pedido) — Cofre de Documentos. Reativar: descomentar esta linha.
      // { href: '/documentos', label: 'Cofre de Documentos', icon: ShieldCheck, badge: 'novo' as string | null },
      { href: '/equipe', label: 'Equipe', icon: Users, badge: null as string | null },
      { href: '/conta', label: 'Minha Conta', icon: CreditCard, badge: null as string | null },
      { href: '/manual', label: 'Manual do usuário', icon: BookOpen, badge: null as string | null },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [alertCount, setAlertCount] = useState(0)

  useEffect(() => {
    setAlertCount(contarNaoLidas())
    // Refresh badge every 30s
    const id = setInterval(() => setAlertCount(contarNaoLidas()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Clear badge when on alertas page
  useEffect(() => {
    if (pathname === '/alertas') setAlertCount(0)
  }, [pathname])

  // Drawer no mobile (T25): a sidebar vira off-canvas com hamburger.
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [pathname])

  const userName = session?.user?.name ?? 'Usuário'
  const userEmail = session?.user?.email ?? ''
  const userImage = session?.user?.image

  // Teste grátis: dias restantes (banner no rodapé).
  const su = session?.user as { status?: string | null; expiraEm?: string | null; plano?: string | null; role?: string | null } | undefined
  const emTrial = su?.status === 'trial'
  // Acesso Pro (master/trial/plano pro). Essencial vê as rotas Pro travadas.
  const acessoPro = temAcessoPro({ plano: su?.plano, role: su?.role, status: su?.status })
  const diasRestantes = emTrial && su?.expiraEm
    ? Math.ceil((new Date(su.expiraEm + 'T23:59:59Z').getTime() - Date.now()) / 86_400_000)
    : null
  const initials = userName
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const NAV = NAV_STATIC.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => IA_HABILITADA || !IA_HREFS.has(item.href))
      .map((item) => ({
        ...item,
        badge: item.href === '/alertas' && alertCount > 0
          ? String(alertCount)
          : item.badge,
      })),
  })).filter((section) => section.items.length > 0)

  return (
    <>
      {/* Hamburger — só no mobile */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="md:hidden fixed top-3 left-3 z-[60] w-9 h-9 rounded-lg bg-bg2 border border-subtle flex items-center justify-center text-strong shadow-lg"
      >
        <Menu size={18} />
      </button>

      {/* Backdrop */}
      {open && <div className="md:hidden fixed inset-0 bg-black/50 z-[55]" onClick={() => setOpen(false)} />}

      <aside className={clsx(
        'w-[220px] min-w-[220px] bg-bg2 border-r border-subtle flex flex-col h-screen z-[58]',
        'fixed inset-y-0 left-0 transition-transform duration-200 md:static md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-subtle relative">
        <button onClick={() => setOpen(false)} aria-label="Fechar menu" className="md:hidden absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-strong"><X size={16} /></button>
        <div>
          <Image src="/logo-govhealth.png" alt="GovHealth" width={150} height={68} className="h-7 w-auto" />
          <div className="font-mono-custom text-[10px] text-faint mt-1 tracking-wide">Sales Intelligence</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((section) => (
          <div key={section.label} className="mb-1">
            <div className="px-4 py-2 text-[10px] font-mono-custom text-faint uppercase tracking-wider">
              {section.label}
            </div>
            {section.items.map((item) => {
              const active = pathname === item.href
              const isAlertBadge = item.href === '/alertas' && alertCount > 0
              // Rota Pro sem acesso: fica travada e leva à tela de upgrade.
              const locked = ehRotaPro(item.href) && !acessoPro
              const href = locked ? `/assinar?upgrade=pro&recurso=${encodeURIComponent(item.href)}` : item.href
              return (
                <Link
                  key={item.href}
                  href={href}
                  onClick={() => setOpen(false)}
                  title={locked ? 'Disponível no plano Pro' : undefined}
                  className={clsx(
                    'flex items-center gap-2.5 mx-1 px-3 py-2 rounded-md text-[13px] transition-all relative',
                    active
                      ? 'bg-bg4 text-accent'
                      : locked
                      ? 'text-faint/70 hover:bg-bg3 hover:text-muted'
                      : 'text-muted hover:bg-bg3 hover:text-strong'
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent rounded-r" />
                  )}
                  <item.icon
                    size={15}
                    className={clsx('flex-shrink-0', active ? 'opacity-100' : locked ? 'opacity-40' : 'opacity-60')}
                  />
                  <span className="flex-1">{item.label}</span>
                  {locked ? (
                    <Lock size={11} className="text-faint flex-shrink-0" />
                  ) : item.badge ? (
                    <span
                      className={clsx(
                        'text-[10px] font-mono-custom font-semibold px-1.5 py-0.5 rounded-full',
                        item.badge === 'IA'
                          ? 'bg-purple/20 text-brand-purple'
                          : isAlertBadge
                          ? 'bg-red/20 text-red'
                          : 'bg-accent text-black'
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-subtle">
        {emTrial && (
          <Link href={`/assinar?plano=${su?.plano || 'pro'}`}
            className="block mb-2 p-2.5 rounded-lg border border-accent/40 bg-accent/10 hover:bg-accent/15 transition-colors">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
              <Flame size={12} />
              {diasRestantes !== null && diasRestantes > 0
                ? `Teste grátis · ${diasRestantes} dia${diasRestantes > 1 ? 's' : ''} restante${diasRestantes > 1 ? 's' : ''}`
                : 'Seu teste expirou'}
            </div>
            <div className="text-[10.5px] text-muted mt-0.5">Assinar para manter o acesso →</div>
          </Link>
        )}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-bg3">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt={userName} className="w-7 h-7 rounded-full flex-shrink-0 object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-brand-blue flex items-center justify-center text-[11px] font-semibold text-black flex-shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-strong truncate">{userName}</div>
            <div className="text-[10px] text-faint font-mono-custom truncate">{userEmail}</div>
          </div>
          <button
            onClick={() => { clearLocalData(); signOut({ callbackUrl: '/login' }) }}
            title="Sair"
            className="flex-shrink-0 p-1 rounded hover:bg-bg4 text-faint hover:text-red-400 transition-colors"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
      </aside>
    </>
  )
}
