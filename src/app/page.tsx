// src/app/page.tsx
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import KPICards from '@/components/dashboard/KPICards'
import OpportunityList from '@/components/dashboard/OpportunityList'
import AlertsFeed from '@/components/dashboard/AlertsFeed'
import DashboardCharts from '@/components/dashboard/DashboardCharts'
import ConcorrentesWidget from '@/components/dashboard/ConcorrentesWidget'

export default function DashboardPage() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Dashboard executivo" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">

          {/* KPIs */}
          <KPICards />

          {/* Oportunidades + Alertas/Concorrentes */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-bg2 border border-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-heading font-semibold text-[13px] text-strong">
                  Oportunidades prioritárias
                </span>
              </div>
              <OpportunityList limit={6} />
            </div>

            <div className="flex flex-col gap-3">
              <div className="bg-bg2 border border-subtle rounded-xl p-4 flex-1">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber" />
                  <span className="font-heading font-semibold text-[13px] text-strong">
                    Alertas inteligentes
                  </span>
                </div>
                <AlertsFeed />
              </div>

              <div className="bg-bg2 border border-subtle rounded-xl p-4">
                <div className="font-heading font-semibold text-[13px] text-strong mb-3">
                  Top concorrentes nacionais
                </div>
                <ConcorrentesWidget />
              </div>
            </div>
          </div>

          {/* Charts: tendência + categorias */}
          <DashboardCharts />

        </main>
      </div>
    </div>
  )
}
