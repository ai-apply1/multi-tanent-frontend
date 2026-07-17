import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/layout/Sidebar"
import { TopBar } from "@/components/layout/TopBar"

/**
 * DevExcel-style app shell: 236px fixed sidebar (branded, white), 60px
 * sticky top header, main body sits on the cool surface-2 tint. Sidebar
 * is hidden below `lg`; on smaller viewports the TopBar exposes a
 * hamburger drawer that renders the same nav sections.
 */
export function DashboardLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--surface-2)] text-[var(--ink)]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
