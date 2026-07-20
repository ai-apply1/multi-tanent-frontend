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
        {/* THIS element is the app's scroll container — the window never
            scrolls, because the shell above is `h-screen overflow-hidden`.
            `scrollbar-gutter: stable` reserves the scrollbar's width whether or
            not one is drawn, so moving between a tall page and a short one
            can't add/remove the bar, change this box's content width, and jerk
            the centred page sideways. Most obvious on Settings, where switching
            tabs swaps a one-field pane for a stack of cards.
            Deliberately `overflow-y-auto`, not `scroll`: forcing the track does
            reserve the width too, but it paints a scrollbar on every short page
            where there is nothing to scroll, which is worse than the problem it
            solves. */}
        <main className="scroll min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
