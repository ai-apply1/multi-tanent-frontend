import { useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import {
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun
} from "lucide-react"
import { BrandLogo } from "@/components/BrandLogo"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useAuth } from "@/features/auth/AuthContext"
import { useOrganization } from "@/features/organization/useOrganization"
import { useTheme } from "@/features/theme/ThemeContext"
import { ROUTES } from "@/routes"
import { navSections, visibleSections } from "@/components/layout/Sidebar"

function initialsFor(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "A"
  )
}

interface TopBarProps {
  onToggleSidebar?: () => void
  sidebarCollapsed?: boolean
}

export function TopBar({ onToggleSidebar, sidebarCollapsed = false }: TopBarProps) {
  const { user, logout } = useAuth()
  const { data: organization, isLoading: isOrgLoading } = useOrganization()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  // Mobile / tablet: a slide-in left drawer holds the same nav
  // sections the desktop sidebar renders. The desktop `<aside>`
  // itself is gated on `lg:flex` and therefore invisible below
  // 1024px, so without this drawer an admin on a phone would have
  // zero way to reach the rest of the app.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  const sections = visibleSections(navSections, user?.role)
  const displayName = user?.fullName || user?.email || ""

  const handleLogout = async () => {
    try {
      await logout()
      toast.success("Signed out.")
    } catch {
      // `AuthContext.logout` tears the session down in its own `finally`, so
      // the admin IS signed out locally and ProtectedRoute redirects either
      // way. Say so rather than inviting a retry that /login can't offer.
      toast.error("Signed out locally, but the server session may still be active.")
    } finally {
      // Must follow the teardown, not the happy path — the error branch would
      // otherwise skip the redirect entirely.
      navigate(ROUTES.LOGIN, { replace: true })
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Mobile / tablet hamburger. Opens the same nav sections
            the desktop sidebar shows. Hidden at `lg:` where the
            permanent left rail is visible. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileNavOpen(true)}
          aria-label="Open menu"
          aria-expanded={isMobileNavOpen}
          aria-controls="admin-mobile-nav"
          className="lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:inline-flex"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        )}

        {/* The tenant's identity, not ours. The fixed `h-8` reserves the row
            before the org resolves, so swapping in a logo of any aspect ratio
            can't reflow the header — and while it's in flight we render
            nothing rather than flashing the Jobjen mark at an org that has
            its own. `isLoading` (not `isPending`) is the right signal: the
            query is disabled without a session, and a disabled query stays
            pending forever, which would hide the fallback on the login-
            adjacent renders. */}
        <div className="flex h-8 min-w-0 items-center gap-2">
          {organization?.logoUrl ? (
            <img
              src={organization.logoUrl}
              alt={organization.name}
              className="h-8 w-auto max-w-36 shrink-0 object-contain"
              draggable={false}
            />
          ) : isOrgLoading ? null : (
            <BrandLogo size="md" />
          )}
          {organization?.name ? (
            <span
              className="hidden max-w-48 truncate text-sm font-semibold sm:block"
              title={organization.name}
            >
              {organization.name}
            </span>
          ) : null}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full p-1 transition hover:bg-accent">
              <Avatar>
                <AvatarFallback>{displayName ? initialsFor(displayName) : "A"}</AvatarFallback>
              </Avatar>
              <div className="hidden text-left text-xs sm:block">
                <p className="font-medium leading-tight">{user?.fullName || "Administrator"}</p>
                <p className="text-muted-foreground">{user?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
            <div className="px-2 pb-2 text-sm">
              <p className="font-medium">{user?.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile / tablet navigation drawer. Mirrors the desktop
          sidebar's `navSections` (single source of truth lives in
          `Sidebar.tsx`), including its `requiresRole` gating — a nav
          item hidden on the rail must not reappear here. Closes on
          backdrop tap, Esc, the close button, OR when a NavLink is
          tapped — that last bit means tapping a section takes the
          admin to the page AND collapses the drawer in one motion. */}
      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          id="admin-mobile-nav"
          side="left"
          className="bg-sidebar text-sidebar-foreground p-0 sm:max-w-xs"
        >
          <SheetHeader className="border-sidebar-border">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </div>
              <SheetTitle className="truncate text-base">
                {organization?.name || "Dashboard"}
              </SheetTitle>
            </div>
          </SheetHeader>
          <SheetBody className="px-3 py-4">
            <nav className="space-y-4">
              {sections.map((section, sectionIdx) => (
                <div key={section.label ?? sectionIdx} className="space-y-1">
                  {section.label ? (
                    <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {section.label}
                    </p>
                  ) : null}
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end ?? true}
                      onClick={() => setIsMobileNavOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                        )
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </header>
  )
}
