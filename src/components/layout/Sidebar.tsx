import { NavLink } from "react-router-dom";
import {
  Clapperboard,
  Film,
  Inbox,
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/routes";
import { useLinkRequestCount } from "@/features/applicants/useLinkRequestCount";

export interface NavSection {
  label?: string;
  items: { label: string; to: string; icon: LucideIcon }[];
}

/**
 * Single source of truth for the admin navigation. Exported so the
 * mobile hamburger drawer (in `TopBar.tsx`) can render the same
 * sections without going through the desktop-only `<aside>` (which
 * is gated on `lg:flex` and therefore invisible on phones / tablets).
 *
 * Trimmed for the multi-tenant migration to the pages ported so far:
 * Overview, Applicants, Questions, Demo Video, Apply Video.
 */
export const navSections: NavSection[] = [
  {
    items: [{ label: "Overview", to: ROUTES.OVERVIEW, icon: LayoutDashboard }],
  },
  {
    label: "AI Interview",
    items: [
      { label: "Applicants", to: ROUTES.APPLICANTS, icon: Inbox },
      {
        label: "Questions",
        to: ROUTES.INTERVIEW_QUESTIONS,
        icon: ListChecks,
      },
      {
        label: "Demo Video",
        to: ROUTES.INTERVIEW_DEMO_VIDEO,
        icon: Clapperboard,
      },
    ],
  },
  {
    label: "Landing Page",
    items: [
      { label: "Apply Video", to: ROUTES.LANDING_APPLY_VIDEO, icon: Film },
    ],
  },
];

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { data: linkRequestCount = 0 } = useLinkRequestCount();
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex",
        // Desktop only: pin the rail to the viewport so it stays in view as
        // the page/table scrolls (it's `hidden` on mobile, where the TopBar
        // hamburger drawer is used instead). `h-screen` + `self-start` stops
        // the flex row from stretching it, `overflow-y-auto` lets the nav
        // scroll internally if it ever exceeds the viewport height.
        "lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-y-auto",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center gap-2 border-b border-sidebar-border",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              Jobjen Admin
            </p>
          </div>
        )}
      </div>

      <nav className={cn("flex-1 space-y-4 py-4", collapsed ? "px-2" : "px-3")}>
        {navSections.map((section, sectionIdx) => (
          <div key={section.label ?? sectionIdx} className="space-y-1">
            {!collapsed && section.label ? (
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center rounded-md text-sm font-medium transition-colors",
                    collapsed ? "justify-center p-2" : "gap-2 px-3 py-2",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {/* Pending link-requests indicator: a count pill when the
                    rail is expanded, a small dot when collapsed. Retained
                    from the source; only renders once a Link Requests nav
                    item exists (not migrated yet), so it stays dormant. */}
                {item.to === ROUTES.LINK_REQUESTS && linkRequestCount > 0 ? (
                  collapsed ? (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
                  ) : (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      {linkRequestCount > 99 ? "99+" : linkRequestCount}
                    </span>
                  )
                ) : null}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
