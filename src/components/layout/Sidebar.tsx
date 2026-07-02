'use client'
// src/components/layout/Sidebar.tsx

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import {
  LayoutDashboard, Map, Bot, Users, GitBranch, Zap, BookOpen, BarChart3, TrendingDown, Kanban, Globe2, LogOut, Bell, UserCircle,
  Boxes, FileSearch, FolderKanban, FileSignature, Landmark, Trophy, PieChart, Layers, Store, CalendarClock, Flame,
} from 'lucide-react'
import { useSession, signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { contarNaoLidas } from '@/lib/alertas'
import { IA_HABILITADA } from '@/lib/features'

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
      { href: '/fornecedores', label: 'Fornecedores', icon: Store, badge: 'novo' as string | null },
      { href: '/concorrentes-estado', label: 'Concorrentes/UF', icon: PieChart, badge: 'novo' as string | null },
      { href: '/breakdown', label: 'Breakdown', icon: Layers, badge: 'novo' as string | null },
      { href: '/concorrentes', label: 'Concorrentes', icon: Users, badge: null as string | null },
      { href: '/timeline', label: 'Timeline', icon: GitBranch, badge: '3' as string | null },
      { href: '/precos', label: 'Preços Ref.', icon: TrendingDown, badge: null as string | null },
      { href: '/crm', label: 'Pipeline CRM', icon: Kanban, badge: null as string | null },
      { href: '/agenda', label: 'Agenda de Prazos', icon: CalendarClock, badge: null as string | null },
      { href: '/editais', label: 'Dossiês de Edital', icon: FolderKanban, badge: null as string | null },
      { href: '/contratos', label: 'Contratos.gov', icon: FileSignature, badge: null as string | null },
      { href: '/estados', label: 'Portais Estaduais', icon: Globe2, badge: '27' as string | null },
      { href: '/radar-verba', label: 'Radar de Verba', icon: Flame, badge: 'novo' as string | null },
      { href: '/emendas', label: 'Emendas Saúde', icon: Landmark, badge: null as string | null },
      { href: '/alertas', label: 'Alertas', icon: Bell, badge: null as string | null },
    ],
  },
  {
    label: 'Conta',
    items: [
      { href: '/portfolio', label: 'Meu Portfólio', icon: Boxes, badge: null as string | null },
      { href: '/perfil', label: 'Perfil & Preferências', icon: UserCircle, badge: null as string | null },
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

  const userName = session?.user?.name ?? 'Usuário'
  const userEmail = session?.user?.email ?? ''
  const userImage = session?.user?.image
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
    <aside className="w-[220px] min-w-[220px] bg-bg2 border-r border-subtle flex flex-col h-screen">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-subtle">
        <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
            <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="#000" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="8" cy="8" r="2" fill="#000"/>
          </svg>
        </div>
        <div>
          <div className="font-heading font-bold text-[15px] text-strong leading-none">GovHealth.ai</div>
          <div className="font-mono-custom text-[10px] text-faint mt-0.5 tracking-wide">Sales Intelligence</div>
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
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-2.5 mx-1 px-3 py-2 rounded-md text-[13px] transition-all relative',
                    active
                      ? 'bg-bg4 text-accent'
                      : 'text-muted hover:bg-bg3 hover:text-strong'
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent rounded-r" />
                  )}
                  <item.icon
                    size={15}
                    className={clsx('flex-shrink-0', active ? 'opacity-100' : 'opacity-60')}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
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
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-subtle">
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
            onClick={() => signOut({ callbackUrl: '/login' })}
            title="Sair"
            className="flex-shrink-0 p-1 rounded hover:bg-bg4 text-faint hover:text-red-400 transition-colors"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}
