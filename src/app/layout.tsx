// src/app/layout.tsx
import type { Metadata } from 'next'
import { DM_Sans, Syne, DM_Mono } from 'next/font/google'
import './globals.css'
import SessionProvider from '@/components/providers/SessionProvider'
import NotificationsWatcher from '@/components/NotificationsWatcher'

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-syne',
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GovHealth AI — Inteligência Comercial para Saúde Pública',
  description:
    'Plataforma de sales intelligence para fornecedores de equipamentos e serviços à saúde pública brasileira. Dados do PNCP, TransfereGov e Portal da Transparência em tempo real.',
  keywords: ['licitações saúde', 'pregão hospitalar', 'TransfereGov', 'PNCP', 'saúde pública'],
  openGraph: {
    title: 'GovHealth AI',
    description: 'Copiloto de inteligência comercial para vendas governamentais na saúde',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${dmSans.variable} ${syne.variable} ${dmMono.variable}`}>
      <body className="bg-bg text-strong antialiased font-sans">
          <SessionProvider>
          <NotificationsWatcher />
          {children}
        </SessionProvider>
        </body>
    </html>
  )
}
