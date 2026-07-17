import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Briefcase,
  GitBranch,
  LayoutGrid,
  Library,
  LogOut,
  Menu,
  Settings,
  Users2,
  UserSquare2,
  X,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/routes";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrganization } from "@/features/organization/useOrganization";
import type { UserRole } from "@/features/auth/types";

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  requiresRole?: UserRole;
  end?: boolean;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    items: [
      { label: "Overview", to: ROUTES.OVERVIEW, icon: LayoutGrid },
      { label: "Jobs", to: ROUTES.JOBS, icon: Briefcase, end: false },
      { label: "Candidates", to: ROUTES.CANDIDATES, icon: Users2 },
      { label: "Question bank", to: ROUTES.QUESTIONS, icon: Library },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Pipeline", to: ROUTES.PIPELINE, icon: GitBranch },
      { label: "Organization", to: ROUTES.ORG_SETTINGS, icon: Settings },
      {
        label: "Team",
        to: ROUTES.TEAM,
        icon: UserSquare2,
        requiresRole: "org_admin",
      },
    ],
  },
];

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

function initialsFor(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "U"
  );
}

/**
 * DevExcel org portal sidebar. 236px wide, white surface with a right
 * border. Active item highlight is `accent-soft` bg + `accent` text with
 * a 3px accent rail extending -12px into the row's negative-left margin.
 * Mobile: hidden behind a hamburger drawer exposed via `<MobileNavTrigger>`
 * (rendered inside the TopBar).
 */
export function Sidebar() {
  const { user, logout } = useAuth();
  const { data: organization } = useOrganization();
  const navigate = useNavigate();
  const sections = visibleSections(navSections, user?.role);

  const orgName = organization?.name || "DevExcel";
  const orgInitials =
    (organization?.name && initialsFor(organization.name)) || "DE";

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Signed out.");
    } catch {
      toast.error(
        "Signed out locally, but the server session may still be active.",
      );
    } finally {
      navigate(ROUTES.LOGIN, { replace: true });
    }
  };

  return (
    <aside className="hidden w-[236px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-[60px] items-center gap-2.5 border-b border-line px-4">
        {organization?.logoUrl ? (
          // Dark-mode legibility: orgs upload ONE logo (usually dark ink on a
          // transparent background), so on the dark theme we render it on a
          // small white plate. Zero visual change in light mode where the
          // sidebar surface is already white.
          <span className="inline-flex items-center rounded-md dark:bg-white dark:px-2 dark:py-1">
            <img
              src={organization.logoUrl}
              alt={orgName}
              title={orgName}
              className="h-8 w-auto max-w-[180px] object-contain dark:h-7"
              draggable={false}
            />
          </span>
        ) : (
          <span
            title={orgName}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-[14px] font-bold text-primary-foreground"
          >
            {orgInitials}
          </span>
        )}
      </div>

      <nav className="scroll flex-1 overflow-auto px-3 pt-2.5 pb-1">
        {sections.map((section, sectionIdx) => (
          <div
            key={section.label ?? sectionIdx}
            className={sectionIdx > 0 ? "mt-2" : undefined}
          >
            {section.label ? (
              <div className="px-2.5 pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-subtle">
                {section.label}
              </div>
            ) : null}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? true}
                className={({ isActive }) =>
                  cn(
                    "group relative mb-0.5 flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
                    isActive
                      ? "bg-accent text-primary"
                      : "text-ink-2 hover:bg-hover",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span className="absolute -left-3 top-2.5 bottom-2.5 w-[3px] rounded-full bg-primary" />
                    ) : null}
                    <item.icon
                      className="h-[17px] w-[17px] shrink-0"
                      strokeWidth={1.7}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary">
          {initialsFor(user?.fullName || user?.email || "U")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold">
            {user?.fullName || "User"}
          </div>
          <div className="truncate text-[11px] text-ink-muted">
            {user?.role === "org_admin" ? "Org admin" : "Recruiter"}
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          title="Sign out"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-ink-muted transition hover:bg-accent hover:text-primary"
        >
          <LogOut className="h-[17px] w-[17px]" />
        </button>
      </div>
    </aside>
  );
}

/**
 * Compact hamburger button + slide-in drawer for mobile. Rendered from
 * the TopBar; keeps its own open state so the TopBar can stay a
 * near-empty header shell.
 */
export function MobileNavTrigger() {
  const { user, logout } = useAuth();
  const { data: organization } = useOrganization();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const sections = visibleSections(navSections, user?.role);

  const orgName = organization?.name || "DevExcel";
  const orgInitials =
    (organization?.name && initialsFor(organization.name)) || "DE";

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Signed out.");
    } catch {
      toast.error(
        "Signed out locally, but the server session may still be active.",
      );
    } finally {
      navigate(ROUTES.LOGIN, { replace: true });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-3 lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/35"
          style={{ animation: "om-fade .12s ease" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute inset-y-0 left-0 flex w-[236px] max-w-[92%] flex-col bg-surface"
            style={{ animation: "om-slide .2s cubic-bezier(.2,.7,.2,1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-[60px] items-center gap-2.5 border-b border-line px-4">
              {organization?.logoUrl ? (
                <span className="inline-flex items-center rounded-md dark:bg-white dark:px-2 dark:py-1">
                  <img
                    src={organization.logoUrl}
                    alt={orgName}
                    title={orgName}
                    className="h-9 w-auto max-w-[160px] object-contain dark:h-7"
                    draggable={false}
                  />
                </span>
              ) : (
                <span
                  title={orgName}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-[14px] font-bold text-primary-foreground"
                >
                  {orgInitials}
                </span>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-ink-muted hover:text-ink"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="scroll flex-1 overflow-auto px-3 pt-2.5">
              {sections.map((section, idx) => (
                <div
                  key={section.label ?? idx}
                  className={idx > 0 ? "mt-2" : undefined}
                >
                  {section.label ? (
                    <div className="px-2.5 pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-subtle">
                      {section.label}
                    </div>
                  ) : null}
                  {section.items.map((item) => {
                    const active = location.pathname.startsWith(item.to);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end ?? true}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "mb-0.5 flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-medium",
                          active
                            ? "bg-accent text-primary"
                            : "text-ink-2 hover:bg-hover",
                        )}
                      >
                        <item.icon
                          className="h-[17px] w-[17px]"
                          strokeWidth={1.7}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary">
                {initialsFor(user?.fullName || user?.email || "U")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">
                  {user?.fullName || "User"}
                </div>
                <div className="truncate text-[11px] text-ink-muted">
                  {user?.role === "org_admin" ? "Org admin" : "Recruiter"}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-ink-muted hover:bg-accent hover:text-primary"
              >
                <LogOut className="h-[17px] w-[17px]" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
