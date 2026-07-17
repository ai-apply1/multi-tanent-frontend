import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import { Sidebar } from "@/components/layout/Sidebar"
import { TopBar } from "@/components/layout/TopBar"

// Bumped to `-v2` so the new collapsed-by-default actually takes effect for
// everyone: the previous key was persisted on every mount, so existing
// sessions all carried the old open-by-default value and would otherwise
// never see the change.
const SIDEBAR_COLLAPSED_KEY = "admin-sidebar-collapsed-v2"

const readInitialCollapsed = (): boolean => {
  // The sidebar starts CLOSED by default. We only keep it open when the
  // operator has explicitly expanded it before (persisted under the key).
  if (typeof window === "undefined") return true
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (stored === null) return true
    return stored === "true"
  } catch {
    return true
  }
}

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed)

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
    } catch {
      // Storage may be blocked — preference just won't persist this session.
    }
  }, [collapsed])

  const toggleSidebar = () => setCollapsed((c) => !c)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar collapsed={collapsed} />
      {/* `min-w-0` is critical: this column is a flex child and would
          otherwise default to `min-width: auto`, refusing to shrink
          below its content's min-content size. Any descendant with
          `white-space: nowrap` (e.g. a `truncate` lesson description
          deep in the tree) would then push the entire page wider than
          the viewport, producing a page-level horizontal scrollbar. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar onToggleSidebar={toggleSidebar} sidebarCollapsed={collapsed} />
        {/* Padding scales with viewport so narrow phones (~360px)
            don't sacrifice 48px to gutters. `px-4` (16px) on mobile
            preserves usable column width for the data tables; `sm:`
            and `lg:` step it up as more horizontal real estate is
            available. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
