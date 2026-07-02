// src/app/page.tsx
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import DashboardView from '@/components/dashboard/DashboardView'

export default function DashboardPage() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar title="Dashboard executivo" />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">
          <DashboardView />
        </main>
      </div>
    </div>
  )
}
