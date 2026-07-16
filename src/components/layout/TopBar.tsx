import { useState } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
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
import { useTheme } from "@/features/theme/ThemeContext"
import { ROUTES } from "@/routes"
import { navSections } from "@/components/layout/Sidebar"
import { useLinkRequestCount } from "@/features/applicants/useLinkRequestCount"

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
  const { admin, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: linkRequestCount = 0 } = useLinkRequestCount()

  // Mobile / tablet: a slide-in left drawer holds the same nav
  // sections the desktop sidebar renders. The desktop `<aside>`
  // itself is gated on `lg:flex` and therefore invisible below
  // 1024px, so without this drawer an admin on a phone would have
  // zero way to reach `Training → Modules / Candidates / Analytics`.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await logout()
      queryClient.clear()
      toast.success("Signed out.")
      navigate(ROUTES.LOGIN, { replace: true })
    } catch {
      toast.error("Could not sign out cleanly. Please try again.")
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 sm:gap-3">
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

        <BrandLogo size="md" />
      </div>

      <div className="ml-auto flex items-center gap-2">
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
                <AvatarFallback>{admin ? initialsFor(admin.name || admin.email) : "A"}</AvatarFallback>
              </Avatar>
              <div className="hidden text-left text-xs sm:block">
                <p className="font-medium leading-tight">{admin?.name || "Administrator"}</p>
                <p className="text-muted-foreground">{admin?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
            <div className="px-2 pb-2 text-sm">
              <p className="font-medium">{admin?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{admin?.email}</p>
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
          `Sidebar.tsx`). Closes on backdrop tap, Esc, the close
          button, OR when a NavLink is tapped — that last bit means
          the admin tapping a section in the drawer is taken to the
          page AND the drawer collapses out of the way in one motion,
          matching the training portal's behaviour. */}
      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          id="admin-mobile-nav"
          side="left"
          className="bg-sidebar text-sidebar-foreground p-0 sm:max-w-xs"
        >
          <SheetHeader className="border-sidebar-border">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </div>
              <SheetTitle className="text-base">Jobjen Admin</SheetTitle>
            </div>
          </SheetHeader>
          <SheetBody className="px-3 py-4">
            <nav className="space-y-4">
              {navSections.map((section, sectionIdx) => (
                <div key={section.label ?? sectionIdx} className="space-y-1">
                  {section.label ? (
                    <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {section.label}
                    </p>
                  ) : null}
                  {section.items.map((item) => {
                    // Match the desktop `Sidebar`'s NavLink behaviour:
                    // `end` is true on a single-segment path, otherwise
                    // false. We compute "active" ourselves so the drawer
                    // can also highlight the current route even on the
                    // initial render before navigation.
                    const isActive = location.pathname === item.to
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end
                        onClick={() => setIsMobileNavOpen(false)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                        {item.to === ROUTES.LINK_REQUESTS &&
                        linkRequestCount > 0 ? (
                          <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                            {linkRequestCount > 99 ? "99+" : linkRequestCount}
                          </span>
                        ) : null}
                      </NavLink>
                    )
                  })}
                </div>
              ))}
            </nav>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </header>
  )
}
