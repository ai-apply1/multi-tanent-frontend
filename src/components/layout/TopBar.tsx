import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { Bell, Clock, LogOut, Moon, Search, Sparkles, Sun, User } from "lucide-react"
import { CommandPalette } from "@/components/layout/CommandPalette"
import { MobileNavTrigger } from "@/components/layout/Sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet"
import { useAuth } from "@/features/auth/AuthContext"
import { useTheme } from "@/features/theme/ThemeContext"
import { ROUTES } from "@/routes"

function initialsFor(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "U"
  )
}

type NotifKind = "success" | "info" | "warning" | "accent"

interface Notif {
  id: string
  kind: NotifKind
  icon: ReactNode
  text: ReactNode
  time: string
  unread: boolean
}

// TODO: replace with real notification feed when the backend exposes one.
const INITIAL_NOTIFS: Notif[] = [
  {
    id: "n1",
    kind: "accent",
    icon: <Sparkles className="h-4 w-4" strokeWidth={1.7} />,
    text: (
      <span>
        <strong className="font-semibold">Grace Hopper</strong> completed the AI interview
      </span>
    ),
    time: "8 min ago",
    unread: true,
  },
  {
    id: "n2",
    kind: "warning",
    icon: <Clock className="h-4 w-4" strokeWidth={1.7} />,
    text: (
      <span>
        Ada Lovelace scored <strong className="font-semibold">91</strong> — awaiting your decision
      </span>
    ),
    time: "1 h ago",
    unread: true,
  },
  {
    id: "n3",
    kind: "info",
    icon: <User className="h-4 w-4" strokeWidth={1.7} />,
    text: (
      <span>
        New application for <strong className="font-semibold">Senior Frontend Engineer</strong>
      </span>
    ),
    time: "3 h ago",
    unread: false,
  },
]

const NOTIF_TINT: Record<NotifKind, string> = {
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  info: "bg-[var(--info-soft)] text-[var(--info)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  accent: "bg-accent text-primary",
}

/**
 * 60px sticky header: a wide search-pill "command palette" trigger on the
 * left (real palette wiring omitted here — clicks it are a no-op), a
 * notifications bell that opens a right-side drawer, and the profile
 * avatar which opens a dropdown containing profile links, the theme
 * toggle, and sign-out. Below `lg:` the search pill hides and the
 * hamburger drawer becomes the primary navigation surface.
 */
export function TopBar() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const displayName = user?.fullName || user?.email || "Admin"
  const email = user?.email || ""
  const rolePill = user?.role === "org_admin" ? "Org admin" : "HR"

  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>(INITIAL_NOTIFS)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global ⌘K / Ctrl+K listener. Runs at the window level rather than being
  // owned by the search pill so the palette opens from anywhere in the app —
  // including inside modal dialogs — the way Cmd+K users expect.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  const handleMarkAllRead = () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, unread: false })))
  }

  const handleSignOut = async () => {
    try {
      await logout()
      toast.success("Signed out.")
    } catch {
      toast.error("Signed out locally, but the server session may still be active.")
    } finally {
      navigate(ROUTES.LOGIN, { replace: true })
    }
  }

  const themeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode"

  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-5 lg:px-6">
      <MobileNavTrigger />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Open command palette"
        className="hidden h-[38px] max-w-[380px] flex-1 items-center gap-2.5 rounded-[9px] border border-line bg-surface-3 px-3.5 text-[13px] text-ink-muted transition hover:border-line-2 lg:flex"
      >
        <Search className="h-[15px] w-[15px]" strokeWidth={1.7} />
        <span className="flex-1 text-left">Search candidates, jobs…</span>
        <span className="mono rounded-[5px] border border-line-2 px-1.5 py-0.5 text-[11px]">⌘K</span>
      </button>

      {/* Mobile shortcut — the wide search pill hides on small screens, so
          expose a tiny 38x38 button that opens the same palette. */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Open command palette"
        className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-surface text-ink-2 transition hover:bg-surface-3 lg:hidden"
      >
        <Search className="h-[17px] w-[17px]" strokeWidth={1.7} />
      </button>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <div className="flex-1 lg:hidden" />

      <div className="ml-auto flex items-center gap-2">
        <Sheet open={notifOpen} onOpenChange={setNotifOpen}>
          <button
            type="button"
            onClick={() => setNotifOpen(true)}
            className="relative flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-surface text-ink-2 hover:bg-surface-3"
            aria-label="Notifications"
          >
            <Bell className="h-[17px] w-[17px]" strokeWidth={1.7} />
            {notifs.some((n) => n.unread) ? (
              <span className="absolute right-[9px] top-[9px] h-[7px] w-[7px] rounded-full bg-[var(--danger)] ring-2 ring-surface" />
            ) : null}
          </button>

          <SheetContent
            side="right"
            hideCloseButton
            className="flex w-[380px] max-w-[92%] flex-col border-l border-line bg-surface p-0 sm:max-w-[380px]"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="text-[16px] font-semibold text-ink">Notifications</div>
              <div className="flex items-center gap-1">
                {notifs.some((n) => n.unread) ? (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink"
                  >
                    Mark all read
                  </button>
                ) : null}
                <SheetClose
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-surface-3 hover:text-ink"
                  aria-label="Close notifications"
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M5 5l10 10M15 5 5 15" />
                  </svg>
                </SheetClose>
              </div>
            </div>

            <div className="scroll flex-1 overflow-auto">
              {notifs.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <div className="text-[13px] text-ink-muted">You're all caught up.</div>
                  <div className="mt-1 text-[12px] text-ink-subtle">No new notifications</div>
                </div>
              ) : (
                notifs.map((n) => (
                  <div
                    key={n.id}
                    className={
                      "flex cursor-pointer gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-hover " +
                      (n.unread ? "bg-[var(--accent-softer)]" : "")
                    }
                  >
                    <span
                      className={
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] " +
                        NOTIF_TINT[n.kind]
                      }
                    >
                      {n.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] leading-snug text-ink">{n.text}</div>
                      <div className="mt-1 text-[11.5px] text-ink-subtle">{n.time}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-[38px] items-center gap-2 rounded-[9px] px-1.5 transition hover:bg-surface-3"
              aria-label="Open profile menu"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-primary">
                {initialsFor(displayName)}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="px-3 py-2.5">
              <div className="truncate text-[13.5px] font-semibold text-ink">{displayName}</div>
              {email ? <div className="truncate text-[12px] text-ink-muted">{email}</div> : null}
              <span className="mt-1.5 inline-block rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-primary">
                {rolePill}
              </span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
              <User className="h-3.5 w-3.5" strokeWidth={1.7} />
              Your profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(ROUTES.SETTINGS)}>
              <Bell className="h-3.5 w-3.5" strokeWidth={1.7} />
              Notification settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                toggleTheme()
              }}
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" strokeWidth={1.7} />
              ) : (
                <Moon className="h-3.5 w-3.5" strokeWidth={1.7} />
              )}
              {themeLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleSignOut()
              }}
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.7} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
