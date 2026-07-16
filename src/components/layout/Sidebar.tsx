import { NavLink } from "react-router-dom";
import {
  Briefcase,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/routes";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrganization } from "@/features/organization/useOrganization";
import type { UserRole } from "@/features/auth/types";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hide the item unless the signed-in user holds this role. */
  requiresRole?: UserRole;
  /** Optional count pill (a dot when the rail is collapsed). */
  badge?: number;
  /**
   * `false` keeps the item highlighted on child routes — Jobs must stay
   * active on `/dashboard/jobs/:id/edit`. Defaults to exact matching,
   * without which `/dashboard/jobs` would light up on every child route
   * of every sibling that nests under it.
   */
  end?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Single source of truth for the navigation. Exported so the mobile
 * hamburger drawer (in `TopBar.tsx`) can render the same sections without
 * going through the desktop-only `<aside>` (which is gated on `lg:flex`
 * and therefore invisible on phones / tablets). Both consumers must honour
 * `requiresRole`.
 */
export const navSections: NavSection[] = [
  {
    items: [{ label: "Overview", to: ROUTES.OVERVIEW, icon: LayoutDashboard }],
  },
  {
    label: "Recruiting",
    items: [
      { label: "Jobs", to: ROUTES.JOBS, icon: Briefcase, end: false },
      { label: "Candidates", to: ROUTES.CANDIDATES, icon: Inbox },
      { label: "Question Bank", to: ROUTES.QUESTIONS, icon: ListChecks },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Settings", to: ROUTES.ORG_SETTINGS, icon: Settings },
      { label: "Team", to: ROUTES.TEAM, icon: Users, requiresRole: "org_admin" },
    ],
  },
];

/** Drop the items the signed-in role may not see. Shared with `TopBar`. */
export function visibleSections(
  sections: NavSection[],
  role: UserRole | undefined,
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.requiresRole || item.requiresRole === role,
      ),
    }))
    .filter((section) => section.items.length > 0);
}

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { user } = useAuth();
  const { data: organization } = useOrganization();
  const sections = visibleSections(navSections, user?.role);

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
            {/* The org's name, not a product name — this rail is the tenant's.
                The non-breaking space holds the line's height while the org
                resolves, so the brand block never reflows (and never flashes
                a placeholder name that isn't theirs). `truncate` because org
                names are free text and the rail is only 16rem. */}
            <p
              className="truncate text-sm font-semibold leading-tight"
              title={organization?.name}
            >
              {organization?.name || " "}
            </p>
          </div>
        )}
      </div>

      <nav className={cn("flex-1 space-y-4 py-4", collapsed ? "px-2" : "px-3")}>
        {sections.map((section, sectionIdx) => (
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
                end={item.end ?? true}
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
                {item.badge ? (
                  collapsed ? (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
                  ) : (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      {item.badge > 99 ? "99+" : item.badge}
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
