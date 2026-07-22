import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Briefcase,
  ChevronDown,
  LayoutGrid,
  Library,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users2,
  X,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ROUTES, settingsTab } from "@/routes";
import { useAuth } from "@/features/auth/AuthContext";
import { useOrganization } from "@/features/organization/useOrganization";
import type { UserRole } from "@/features/auth/types";
import { USER_ROLE_LABELS } from "@/features/users/types";
import { PLATFORM_NAME } from "@/lib/platform";
import { titleCase } from "@/lib/text";
import { OrgLogo } from "@/components/common/OrgLogo";

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
      { label: "Dashboard", to: ROUTES.OVERVIEW, icon: LayoutGrid },
      { label: "Jobs", to: ROUTES.JOBS, icon: Briefcase, end: false },
      { label: "Candidates", to: ROUTES.CANDIDATES, icon: Users2 },
      { label: "Questions", to: ROUTES.QUESTIONS, icon: Library },
    ],
  },
  // Everything that used to sit in a "Workspace" group (Hiring Pipeline, Team)
  // now lives in the Settings dropdown, rendered by <SettingsNav> rather than
  // from this list, so a reviewer reaches those plus the configuration tabs
  // from one place instead of hunting the nav.
];

/**
 * Children of the collapsible Settings dropdown. A curated subset, NOT every
 * Settings tab: "General" is the entry into the Settings page and "Email
 * templates" deep-links its email tab (the remaining tabs, branding, domains,
 * apply video..., are reached from the in-page tab bar), then the Hiring
 * Pipeline and Team, which were top-level Workspace items before. Team stays
 * org_admin-only, so it carries `requiresRole` and is filtered out for everyone
 * else.
 */
const SETTINGS_CHILDREN: Array<{
  label: string;
  to: string;
  requiresRole?: UserRole;
}> = [
  { label: "General", to: settingsTab("general") },
  { label: "Email templates", to: ROUTES.EMAIL_TEMPLATES },
  { label: "Hiring Pipeline", to: ROUTES.PIPELINE },
  { label: "Manage Team", to: ROUTES.TEAM, requiresRole: "org_admin" },
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
 * The collapsible Settings dropdown, shared by the desktop sidebar and the
 * mobile drawer. The header toggles the list open; each child deep-links to a
 * Settings tab (or the Hiring Pipeline). It auto-expands whenever the current
 * route is one it owns, so a deep link or command-palette jump lands with the
 * relevant section already visible.
 *
 * Active state is computed from the URL rather than left to `NavLink`, because
 * every settings child shares the same pathname (`/dashboard/settings`) and is
 * distinguished only by `?tab=`; NavLink alone would light up all of them at
 * once.
 */
function SettingsNav({
  onNavigate,
  collapsed = false,
  onExpand,
}: {
  onNavigate?: () => void;
  /** Rail mode: render only the Settings icon; clicking it expands the rail. */
  collapsed?: boolean;
  /** Called from rail mode to expand the sidebar before opening the dropdown. */
  onExpand?: () => void;
}) {
  const location = useLocation();
  const { user } = useAuth();
  const onSettings = location.pathname.startsWith(ROUTES.SETTINGS);
  const onPipeline = location.pathname.startsWith(ROUTES.PIPELINE);
  const onTeam = location.pathname.startsWith(ROUTES.TEAM);
  const onEmailTemplates = location.pathname.startsWith(
    ROUTES.EMAIL_TEMPLATES,
  );
  const groupActive = onSettings || onPipeline || onTeam || onEmailTemplates;

  const children = SETTINGS_CHILDREN.filter(
    (c) => !c.requiresRole || c.requiresRole === user?.role,
  );

  // Re-open when navigation lands on an owned route from elsewhere (palette,
  // deep link) by adjusting state during render off a change in `groupActive`,
  // React's recommended alternative to a setState-in-effect. A manual collapse
  // while staying on the route is preserved because `groupActive` is unchanged
  // on that interaction.
  const [open, setOpen] = useState(groupActive);
  const [wasActive, setWasActive] = useState(groupActive);
  if (groupActive !== wasActive) {
    setWasActive(groupActive);
    if (groupActive) setOpen(true);
  }

  const isChildActive = (to: string) => {
    if (to === ROUTES.PIPELINE) return onPipeline;
    if (to === ROUTES.TEAM) return onTeam;
    if (to === ROUTES.EMAIL_TEMPLATES) return onEmailTemplates;
    // The only Settings-page child listed is "General", and it stands in for the
    // whole Settings page in the nav. So it stays active on EVERY settings tab
    // (Branding, Domains, Apply video, and the rest), which are reached from the
    // in-page tab bar, rather than only when its own `?tab=general` is selected.
    // This is what keeps the highlight on General instead of falling back to the
    // Settings group header when you switch tabs inside the page.
    return onSettings;
  };

  // Whether any dropdown child represents the current location. When none does
  // — an in-page Settings tab we don't list here, like Domains or Branding —
  // the parent header keeps the group highlight so a selection is never empty.
  const someChildActive = children.some((c) => isChildActive(c.to));

  // Rail mode: the dropdown can't render in 68px, so the Settings icon expands
  // the sidebar and opens the list in one click rather than showing a flyout.
  if (collapsed) {
    return (
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => {
          onExpand?.();
          setOpen(true);
        }}
        className={cn(
          "mt-2 flex w-full items-center justify-center rounded-[10px] py-2.5 transition-colors",
          groupActive ? "bg-accent text-primary" : "text-ink-2 hover:bg-hover",
        )}
      >
        <Settings className="h-[17px] w-[17px]" strokeWidth={1.7} />
      </button>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "relative mb-0.5 flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
          // Highlight the header when the group is active AND either the
          // dropdown is closed (its children are hidden) or no child owns the
          // current tab — so switching from General to Domains never leaves the
          // whole Settings group looking unselected.
          groupActive && (!open || !someChildActive)
            ? "bg-accent text-primary"
            : "text-ink-2 hover:bg-hover",
        )}
      >
        <Settings className="h-[17px] w-[17px] shrink-0" strokeWidth={1.7} />
        <span className="flex-1 truncate text-left">Settings</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            open ? "rotate-180" : "",
          )}
          strokeWidth={1.7}
        />
      </button>
      {open ? (
        <div className="mb-1 ml-[17px] space-y-0.5 border-l border-line pl-2.5">
          {children.map((child) => {
            const active = isChildActive(child.to);
            return (
              <Link
                key={child.to}
                to={child.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-accent text-primary"
                    : "text-ink-muted hover:bg-hover hover:text-ink-2",
                )}
              >
                <span className="flex-1 truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * DevExcel org portal sidebar. 236px wide, white surface with a right
 * border. Active item highlight is `accent-soft` bg + `accent` text with
 * a 3px accent rail extending -12px into the row's negative-left margin.
 * Mobile: hidden behind a hamburger drawer exposed via `<MobileNavTrigger>`
 * (rendered inside the TopBar).
 */
/** localStorage key for the desktop collapse preference. */
const COLLAPSE_KEY = "org-sidebar-collapsed";

export function Sidebar() {
  const { user, logout } = useAuth();
  const { data: organization } = useOrganization();
  const navigate = useNavigate();
  const sections = visibleSections(navSections, user?.role);

  // Persisted so the rail preference survives reloads. Read lazily from
  // localStorage (guarded for SSR/private-mode where it can throw).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* private mode: preference just doesn't persist */
      }
      return next;
    });

  // NOT a hardcoded org name. The design branch had `|| "DevExcel"` here, which
  // ships one customer's name to every other customer's sidebar — the exact
  // white-label failure the branding work exists to prevent, and worse than
  // showing the platform's own name because it names a competitor.
  //
  // `PLATFORM_NAME` is the honest fallback: it only ever shows when no org
  // resolved at all (the query is disabled without a session), and it is a
  // neutral placeholder rather than anyone's brand.
  const orgName = organization?.name || PLATFORM_NAME;

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
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-[68px]" : "w-[236px]",
      )}
    >
      <div
        className={cn(
          "flex h-[60px] items-center border-b border-line",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        {collapsed ? (
          // Rail: a compact monogram mark rather than a wordmark that a 68px
          // rail would clip. `OrgLogo` with no `logoUrl` renders the initials.
          <OrgLogo name={orgName} size="sm" />
        ) : (
          <OrgLogo
            logoUrl={organization?.logoUrl}
            logoDarkUrl={organization?.logoDarkUrl}
            name={orgName}
          />
        )}
      </div>

      <nav
        className={cn(
          "scroll flex-1 overflow-auto pt-2.5 pb-1",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {sections.map((section, sectionIdx) => (
          <div
            key={section.label ?? sectionIdx}
            className={sectionIdx > 0 ? "mt-2" : undefined}
          >
            {section.label && !collapsed ? (
              <div className="px-2.5 pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-subtle">
                {section.label}
              </div>
            ) : null}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? true}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    "group relative mb-0.5 flex items-center rounded-[10px] py-2.5 text-[13.5px] font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "gap-3 px-2.5",
                    isActive
                      ? "bg-accent text-primary"
                      : "text-ink-2 hover:bg-hover",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && !collapsed ? (
                      <span className="absolute -left-3 top-2.5 bottom-2.5 w-[3px] rounded-full bg-primary" />
                    ) : null}
                    <item.icon
                      className="h-[17px] w-[17px] shrink-0"
                      strokeWidth={1.7}
                    />
                    {collapsed ? null : (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
        <SettingsNav
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
        />
      </nav>

      {/* Collapse / expand toggle. Its own row above the footer so it stays put
          in both states and never crowds the logo or the user block. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "mx-2 mb-1 flex items-center rounded-[10px] py-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink-2",
          collapsed ? "justify-center px-0" : "gap-3 px-2.5",
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-[17px] w-[17px]" strokeWidth={1.7} />
        ) : (
          <>
            <PanelLeftClose className="h-[17px] w-[17px]" strokeWidth={1.7} />
            <span className="flex-1 truncate text-left">Collapse</span>
          </>
        )}
      </button>

      <div
        className={cn(
          "flex items-center border-t border-line py-3",
          collapsed ? "flex-col gap-2 px-2" : "gap-2.5 px-3.5",
        )}
      >
        <span
          title={collapsed ? titleCase(user?.fullName || "User") : undefined}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary"
        >
          {initialsFor(user?.fullName || user?.email || "U")}
        </span>
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold">
              {titleCase(user?.fullName || "User")}
            </div>
            <div className="truncate text-[11px] text-ink-muted">
              {user?.role ? USER_ROLE_LABELS[user.role as UserRole] ?? "" : ""}
            </div>
          </div>
        )}
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

  // Same rule as the desktop sidebar above: never a hardcoded org name.
  const orgName = organization?.name || PLATFORM_NAME;

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
              <OrgLogo
                logoUrl={organization?.logoUrl}
                logoDarkUrl={organization?.logoDarkUrl}
                name={orgName}
              />
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
              <SettingsNav onNavigate={() => setOpen(false)} />
            </nav>
            <div className="flex items-center gap-2.5 border-t border-line px-3.5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-primary">
                {initialsFor(user?.fullName || user?.email || "U")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">
                  {titleCase(user?.fullName || "User")}
                </div>
                <div className="truncate text-[11px] text-ink-muted">
                  {user?.role ? USER_ROLE_LABELS[user.role as UserRole] ?? "" : ""}
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
