import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import {
  Bell,
  Briefcase,
  CheckCircle2,
  LogOut,
  Moon,
  Search,
  Sun,
  User,
  Users,
  UserPlus,
} from "lucide-react"
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
import { USER_ROLE_LABELS } from "@/features/users/types"
import type { UserRole } from "@/features/auth/types"
import {
  listNotifications,
  markAllNotificationsRead,
} from "@/features/notifications/notificationsApi"
import type {
  Notification,
  NotificationEvent,
} from "@/features/notifications/types"
import { titleCase } from "@/lib/text"
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

const EVENT_STYLES: Record<
  NotificationEvent,
  { icon: typeof Bell; tint: string }
> = {
  interview_completed: {
    icon: CheckCircle2,
    tint: "bg-accent text-primary",
  },
  candidate_status_changed: {
    icon: Users,
    tint: "bg-[var(--info-soft)] text-[var(--info)]",
  },
  team_member_added: {
    icon: UserPlus,
    tint: "bg-[var(--success-soft)] text-[var(--success)]",
  },
  job_created: {
    icon: Briefcase,
    tint: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const seconds = Math.max(1, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * 60px sticky header: command-palette trigger, dark-mode toggle,
 * notification bell, and the profile dropdown.
 */
export function TopBar() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const rawDisplayName = user?.fullName || user?.email || "Admin"
  const displayName = titleCase(rawDisplayName) || rawDisplayName
  const email = user?.email || ""
  const rolePill = user?.role ? USER_ROLE_LABELS[user.role as UserRole] ?? "" : ""

  const [notifOpen, setNotifOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Poll every 60s while the tab is visible; a stale-for-30s window means
  // dropdown opens after a notification fires don't wait a full poll cycle.
  const notifsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications({ limit: 25 }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  })
  const items: Notification[] = notifsQuery.data?.items ?? []
  const unreadCount = notifsQuery.data?.unreadCount ?? 0

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  // Global ⌘K / Ctrl+K listener.
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

  const rendered = useMemo(
    () =>
      items.map((n) => {
        const style = EVENT_STYLES[n.event] ?? {
          icon: Bell,
          tint: "bg-accent text-primary",
        }
        const Icon = style.icon
        return { n, Icon, tint: style.tint }
      }),
    [items],
  )

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
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-surface text-ink-2 transition hover:bg-surface-3"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <Sun className="h-[17px] w-[17px]" strokeWidth={1.7} />
          ) : (
            <Moon className="h-[17px] w-[17px]" strokeWidth={1.7} />
          )}
        </button>

        <Sheet open={notifOpen} onOpenChange={setNotifOpen}>
          <button
            type="button"
            onClick={() => setNotifOpen(true)}
            className="relative flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-line bg-surface text-ink-2 hover:bg-surface-3"
            aria-label="Notifications"
          >
            <Bell className="h-[17px] w-[17px]" strokeWidth={1.7} />
            {unreadCount > 0 ? (
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
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => markAllRead.mutate()}
                    disabled={markAllRead.isPending}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
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
              {notifsQuery.isLoading ? (
                <div className="px-5 py-14 text-center text-[13px] text-ink-muted">
                  Loading…
                </div>
              ) : rendered.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <div className="text-[13px] text-ink-muted">You&apos;re all caught up.</div>
                  <div className="mt-1 text-[12px] text-ink-subtle">No new notifications</div>
                </div>
              ) : (
                rendered.map(({ n, Icon, tint }) => (
                  <div
                    key={n.id}
                    className={
                      "flex cursor-pointer gap-3 border-b border-line px-5 py-3.5 transition last:border-b-0 hover:bg-hover " +
                      (!n.isRead ? "bg-[var(--accent-softer)]" : "")
                    }
                  >
                    <span
                      className={
                        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] " +
                        tint
                      }
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold leading-snug text-ink">{n.title}</div>
                      {n.content ? (
                        <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{n.content}</div>
                      ) : null}
                      <div className="mt-1 text-[11.5px] text-ink-subtle">
                        {relativeTime(n.createdAt)}
                      </div>
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
