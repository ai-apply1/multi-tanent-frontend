import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  Briefcase,
  GitBranch,
  LayoutGrid,
  Library,
  Search,
  Settings,
  UserSquare2,
  Users2,
  type LucideIcon,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { listCandidates } from "@/features/candidates/candidatesApi"
import { listJobs } from "@/features/jobs/jobsApi"
import { useAuth } from "@/features/auth/AuthContext"
import { canManageFunnel } from "@/features/auth/roles"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useAnimatedOverlay } from "@/hooks/useAnimatedOverlay"
import { ROUTES, jobDetail } from "@/routes"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A single palette result row. Kept intentionally shallow: the row only knows
 * its icon, its title/sub, and the navigation target. Selection collapses to
 * "navigate + close" so the input handler can loop over a flat array without
 * caring which group the row belongs to.
 */
interface PaletteItem {
  id: string
  icon: LucideIcon
  title: string
  sub: string
  onSelect: () => void
}

interface PaletteGroup {
  label: string
  items: PaletteItem[]
}

/**
 * Command palette (⌘K / Ctrl+K). Renders a modal centred in the viewport with
 * a search input and result groups: recent Candidates, Jobs, and a static
 * "Go to" list of app routes. Candidate hits deep-link into the Candidates
 * page with `?candidate=<id>` so the drawer auto-opens; job hits navigate to
 * the job detail page.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebouncedValue(query, 200).trim()
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Hold the palette mounted through its close so the backdrop fade + panel
  // pop-out actually play (it renders itself, so `open=false` alone would rip
  // it out instantly). Queries/focus still key off `open`, so they idle the
  // moment a close starts while the already-loaded results fade away.
  const { mounted, phase } = useAnimatedOverlay(open, 180)

  // Reset every time the palette re-opens so a stale query from the previous
  // session never bleeds into the next one.
  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      // Radix-style focus deferral — the input mounts inside a transition
      // wrapper, so focus() must wait a tick.
      const t = window.setTimeout(() => inputRef.current?.focus(), 20)
      return () => window.clearTimeout(t)
    }
  }, [open])

  const querying = debouncedQuery.length >= 2

  // Candidate lookup — capped at 5 hits so the palette never becomes a table.
  // Requires ≥2 chars to avoid a fetch on every trivial keystroke.
  const candidatesQuery = useQuery({
    queryKey: ["palette-candidates", debouncedQuery],
    queryFn: () => listCandidates({ search: debouncedQuery, limit: 5 }),
    enabled: open && Boolean(user) && querying,
    staleTime: 15_000,
  })
  const jobsQuery = useQuery({
    queryKey: ["palette-jobs", debouncedQuery],
    queryFn: () => listJobs({ search: debouncedQuery, limit: 5 }),
    enabled: open && Boolean(user) && querying,
    staleTime: 15_000,
  })

  // Static navigation targets, always available. Filtered client-side
  // against the query so typing "team" surfaces just the Team link.
  const isOrgAdmin = user?.role === "org_admin"
  const canAct = canManageFunnel(user?.role)
  const goToItems = useMemo<PaletteItem[]>(() => {
    const raw: Array<Omit<PaletteItem, "onSelect"> & { to: string }> = [
      { id: "go-overview", icon: LayoutGrid, title: "Dashboard", sub: "Pipeline dashboard", to: ROUTES.OVERVIEW },
      { id: "go-jobs", icon: Briefcase, title: "Jobs", sub: "All postings", to: ROUTES.JOBS },
      // Every other entry is a read-only destination, but this one lands on the
      // job-create form the backend 403s an interviewer on — so it is offered
      // only to the roles that can actually finish it.
      ...(canAct
        ? [{ id: "go-jobs-new", icon: Briefcase, title: "Create job", sub: "New draft posting", to: ROUTES.JOB_NEW }]
        : []),
      { id: "go-candidates", icon: Users2, title: "Candidates", sub: "Every applicant", to: ROUTES.CANDIDATES },
      { id: "go-questions", icon: Library, title: "Questions", sub: "Screening questions", to: ROUTES.QUESTIONS },
      { id: "go-pipeline", icon: GitBranch, title: "Hiring Pipeline", sub: "Candidate statuses", to: ROUTES.PIPELINE },
      { id: "go-settings", icon: Settings, title: "Settings", sub: "Branding, domains, demo video & email", to: ROUTES.SETTINGS },
    ]
    if (isOrgAdmin) {
      raw.push({ id: "go-team", icon: UserSquare2, title: "Manage Team", sub: "Manage members", to: ROUTES.TEAM })
    }
    const q = debouncedQuery.toLowerCase()
    const filtered = q
      ? raw.filter((r) => r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q))
      : raw
    return filtered.map((r) => ({
      id: r.id,
      icon: r.icon,
      title: r.title,
      sub: r.sub,
      onSelect: () => {
        navigate(r.to)
        onOpenChange(false)
      },
    }))
  }, [canAct, debouncedQuery, isOrgAdmin, navigate, onOpenChange])

  const candidateItems = useMemo<PaletteItem[]>(() => {
    const rows = candidatesQuery.data?.data ?? []
    return rows.map((c) => ({
      id: `cand-${c._id}`,
      icon: Users2,
      title: c.fullName || c.email || "Candidate",
      sub: c.email || "Candidate",
      onSelect: () => {
        // Deep-link into the candidates page with a query param the page
        // reads to auto-open the drawer for that row. Drawer state lives on
        // the page — this is the cheapest way to hand it a candidate id
        // from anywhere in the app.
        navigate(`${ROUTES.CANDIDATES}?candidate=${c._id}`)
        onOpenChange(false)
      },
    }))
  }, [candidatesQuery.data, navigate, onOpenChange])

  const jobItems = useMemo<PaletteItem[]>(() => {
    const rows = jobsQuery.data?.data ?? []
    return rows.map((j) => ({
      id: `job-${j._id}`,
      icon: Briefcase,
      title: j.title,
      sub: j.status === "open" ? "Open · " + (j.questionCount ?? 0) + " questions" : j.status,
      onSelect: () => {
        navigate(jobDetail(j._id))
        onOpenChange(false)
      },
    }))
  }, [jobsQuery.data, navigate, onOpenChange])

  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = []
    if (candidateItems.length) out.push({ label: "Candidates", items: candidateItems })
    if (jobItems.length) out.push({ label: "Jobs", items: jobItems })
    if (goToItems.length) out.push({ label: "Go to", items: goToItems })
    return out
  }, [candidateItems, jobItems, goToItems])

  // Flatten across groups for arrow-key navigation — the index is a running
  // count through every group's items so `↓`/`↑` cross group boundaries the
  // way Cmd+K users expect.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  useEffect(() => {
    // Clamp when the result set shrinks so the highlighted row can't point
    // past the end of the list.
    if (activeIndex >= flat.length) setActiveIndex(0)
  }, [flat.length, activeIndex])

  // Points at whichever row is currently highlighted (only the active button
  // gets this ref). Arrow-key navigation can move the selection past the
  // visible edge of the scroll container, so nudge it back into view whenever
  // the selection changes. `block: "nearest"` means an already-visible row
  // never jumps.
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length))
    } else if (e.key === "Enter") {
      e.preventDefault()
      flat[activeIndex]?.onSelect()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onOpenChange(false)
    }
  }

  if (!mounted) return null

  const backdropAnim =
    phase === "exit" ? "overlay-out 0.18s ease forwards" : "overlay-in 0.18s ease forwards"
  const panelAnim = phase === "exit" ? "om-pop-out 0.16s ease forwards" : "om-pop 0.14s ease"

  const loading = querying && (candidatesQuery.isLoading || jobsQuery.isLoading)
  const empty = !loading && querying && groups.every((g) => g.items.length === 0)

  // Track a running flat index across groups so the highlight moves through
  // them contiguously.
  let flatIndex = -1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-[rgba(13,11,11,0.4)]"
      style={{ animation: backdropAnim }}
      onClick={() => onOpenChange(false)}
    >
      {/* Centred exactly the way every other dialog in the app centres
          (`components/ui/dialog.tsx`): a `min-h-full` flex row inside a
          scrollable backdrop. The palette used to be pinned `pt-[100px]` from
          the top, which parked it over the top bar and read as a dropdown off
          the search field rather than as a modal.

          The `min-h-full` wrapper is what makes centring safe. `items-center`
          on the fixed element alone overflows in BOTH directions on a short
          viewport, putting the panel's top edge above the scroll origin where
          nothing can reach it; growing a scrollable child instead pushes the
          overflow downwards, where the backdrop can scroll to it. */}
      <div className="flex min-h-full items-center justify-center px-6 py-6">
        <div
          className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_70px_rgba(13,11,11,0.28)]"
          style={{ animation: panelAnim }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input row */}
          <div className="flex items-center gap-3 border-b border-line px-[18px] py-[15px]">
            <Search className="h-[18px] w-[18px] text-ink-muted" strokeWidth={1.7} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Jump to a candidate, job, or action…"
              className="flex-1 border-none bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-subtle"
            />
            <Key>esc</Key>
          </div>

          {/* Result body */}
          <div className="scroll max-h-[340px] overflow-auto p-2">
            {loading ? (
              <div className="p-1">
                {/* Mirror the result rows — icon tile + a line of text — so the
                    palette body doesn't jump when matches resolve. */}
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-[9px] px-2.5 py-2"
                  >
                    <Skeleton className="h-7 w-7 flex-shrink-0 rounded-[8px]" />
                    <Skeleton className="h-3.5 w-48 max-w-full" />
                  </div>
                ))}
              </div>
            ) : empty ? (
              <div className="px-3 py-8 text-center">
                <div className="text-[13.5px] font-semibold text-ink">No results</div>
                <div className="mt-1 text-[12.5px] text-ink-muted">
                  Try a candidate name, a job title, or a page like &quot;team&quot;.
                </div>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    flatIndex += 1
                    const active = flatIndex === activeIndex
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        type="button"
                        ref={active ? activeItemRef : null}
                        onMouseEnter={((idx) => () => setActiveIndex(idx))(flatIndex)}
                        onClick={item.onSelect}
                        className={
                          "flex w-full cursor-pointer items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors " +
                          // The active row is the one Enter fires, so it has to
                          // be obvious in a glance-and-type flow. `bg-surface-3`
                          // was only a couple of percent off the panel and the
                          // hover state was the SAME colour, so pointer and
                          // keyboard selection were indistinguishable. Accent
                          // tint + a filled icon tile separates them.
                          (active ? "bg-accent" : "hover:bg-hover")
                        }
                      >
                        <span
                          className={
                            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] transition-colors " +
                            (active ? "bg-primary text-primary-foreground" : "bg-surface-3 text-primary")
                          }
                        >
                          <Icon className="h-[15px] w-[15px]" strokeWidth={1.7} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-ink">{item.title}</span>
                          <span className="block truncate text-[12px] text-ink-muted">{item.sub}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer key hints. Wraps rather than overflowing: three hints plus
              their caps do not fit a phone-width panel on one line. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface-2 px-[18px] py-2.5 text-[12px] font-medium text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="flex items-center gap-1">
                <Key>↑</Key>
                <Key>↓</Key>
              </span>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Key>↵</Key>
              open
            </span>
            <span className="flex items-center gap-1.5">
              <Key>esc</Key>
              close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A keycap, used for the footer hints and the input row's `esc` affordance.
 *
 * A `<kbd>`, not a styled `<span>`: the content is literally keyboard input,
 * and "keyboard escape, close" is the entire hint a screen reader has to
 * convey.
 *
 * The caps it replaces were bare 10px outlines in `--ink-subtle`, which lands
 * around 2.5:1 against the footer's `--surface-2` — readable as decoration,
 * not as text. Filled, on `--ink-2`, at 11px, they read as keys at a glance.
 * `min-w-[22px]` is what keeps the single-glyph caps (↑ ↓ ↵) square instead of
 * letting them collapse into slivers beside the wider `esc`.
 */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono inline-flex h-[20px] min-w-[22px] items-center justify-center rounded-[6px] border border-line-2 bg-surface px-1.5 text-[11px] font-semibold leading-none text-ink-2">
      {children}
    </kbd>
  )
}
