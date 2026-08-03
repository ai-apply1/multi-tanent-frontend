import { useEffect, useRef, useState } from "react"
import { Check, Tag } from "lucide-react"
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import {
  manualMoveBlocker,
  type ManualMoveEvidence,
} from "@/features/candidates/manualMove"
import type { CandidateStatus } from "@/features/candidates/types"
import { cn } from "@/lib/utils"

/**
 * The "Change status → Move to" submenu, shared by every actions menu that
 * offers a manual pipeline move (the candidates table row, the interview
 * drawer).
 *
 * It lives here rather than inline at each call site because the two copies had
 * already drifted, and because the thing that makes this menu hard — a list
 * whose length is the ORG's, not ours — has to be solved once. A tenant may
 * invent as many columns as it likes on top of the nine builtins, so this list
 * has no upper bound and the menu must stay usable at any length.
 *
 * Three things carry that:
 *
 *   1. **The cap is viewport-aware, not a fixed number.** Radix publishes how
 *      much room the submenu actually got as
 *      `--radix-dropdown-menu-content-available-height`; the cap is the smaller
 *      of that and 26rem. A hard `max-h-72` (the old value) was both too small
 *      — it cut the ninth builtin off on every full pipeline, which is the bug
 *      this fixes — and, on a short window, too big.
 *   2. **The header does not scroll.** "Move to" and the no-email note are
 *      pinned outside the scroll box, so the scrolling region is unmistakably
 *      the LIST, and the affordances below sit exactly at its edges rather than
 *      floating over prose.
 *   3. **Scrollability is visible at rest** — a permanent styled groove
 *      (`.menu-scroll` in `globals.css`) plus edges that fade only while there
 *      is really something past them. An overlay scrollbar that appears once
 *      you already started scrolling teaches nobody; the whole complaint here
 *      was people not knowing the list continued.
 *
 * The submenu itself (not just its content) is rendered here so the trigger
 * stays identical everywhere too — same label, same icon, same metrics.
 */
export function ChangeStatusSubMenu({
  statuses,
  currentKey,
  candidate,
  pending = false,
  onSelect,
}: {
  /** The org's catalog, in board order. */
  statuses: CandidateStatus[]
  /** Key of the column the candidate is in now — ticked and disabled. */
  currentKey?: string | null
  /**
   * Whatever we know about the candidate, for `manualMoveBlocker`. `null` is
   * allowed for the window where a detail request is still in flight: treat
   * that as unblocked and let the server have the final word, exactly as the
   * drawer did before this was extracted.
   */
  candidate: ManualMoveEvidence | null | undefined
  /** A move is already being written — disable the whole list, don't hide it. */
  pending?: boolean
  onSelect: (statusKey: string) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {/* Every other item in these menus leads with an icon; this one used to
            be the lone exception in the candidates table, which left its label
            hanging on a different x-axis to the rest. */}
        <Tag className="h-3.5 w-3.5" strokeWidth={1.7} />
        Change status
      </DropdownMenuSubTrigger>
      {/* `p-0` because the header and the list carry their own padding — the
          list's has to be INSIDE the scroll box so the last row clears the
          bottom edge, and a wrapper padding would put it outside.
          `flex-col` + the cap is what lets the header stay put while only the
          list shrinks. */}
      <DropdownMenuSubContent className="flex max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height,26rem))] w-60 flex-col overflow-hidden p-0">
        <div className="shrink-0 px-1 pt-1">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {/* A manual move writes the status and nothing else — the backend
              sends no email on this path, so say it at the moment of the
              decision, not in a doc nobody reads. */}
          <p className="px-2 pb-1.5 text-[11.5px] leading-snug text-ink-muted">
            A move never emails the candidate — use{" "}
            <span className="font-medium">Send email</span> to notify them.
          </p>
        </div>
        <StatusList
          statuses={statuses}
          currentKey={currentKey}
          candidate={candidate}
          pending={pending}
          onSelect={onSelect}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * The scrolling half, split out for one reason: Radix does not mount
 * `SubContent`'s children until the submenu opens, so a component that lives
 * in here is guaranteed to measure a list that is actually on screen. Measuring
 * from the parent would run once, while closed, against a null ref.
 */
function StatusList({
  statuses,
  currentKey,
  candidate,
  pending,
  onSelect,
}: {
  statuses: CandidateStatus[]
  currentKey?: string | null
  candidate: ManualMoveEvidence | null | undefined
  pending: boolean
  onSelect: (statusKey: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  /**
   * Which edges the list is currently resting against. Both `true` — the
   * initial value — means "no overflow", which is also the state of a list
   * short enough to fit, so a menu that never scrolls draws no fades at any
   * point, including its first frame.
   */
  const [atTop, setAtTop] = useState(true)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const el = listRef.current
    if (!el) return

    let frame = 0
    const measure = () => {
      frame = 0
      const max = el.scrollHeight - el.clientHeight
      // 1px of slack: sub-pixel layout means `scrollTop` at the very bottom is
      // routinely `max - 0.5`, which would leave the fade on forever.
      setAtTop(el.scrollTop <= 1)
      setAtBottom(el.scrollTop >= max - 1)
    }
    // rAF-coalesced, and the first run is SCHEDULED rather than called inline:
    // scroll fires far more often than the page paints, and this keeps the
    // state write out of the effect body.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    schedule()
    el.addEventListener("scroll", schedule, { passive: true })
    // Both boxes matter and they change independently: the viewport shrinks
    // when Radix flips the submenu against a screen edge, and the content grows
    // when the catalog query resolves after the menu is already open.
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule)
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.removeEventListener("scroll", schedule)
      ro?.disconnect()
    }
  }, [])

  return (
    // `relative` so the fades anchor to the LIST's box, not the whole menu —
    // the header's height is not fixed (the note wraps at some widths), so
    // anchoring to the menu would float the top fade at the wrong y.
    // `flex-auto` and not `flex-1` at both levels: `flex-1` sets `flex-basis:0`,
    // and the menu's height is a `max-height`, i.e. indefinite — a basis of 0
    // leaves the browser sizing this from the intrinsic-flex-fraction rule
    // instead of from the list itself. `flex: 1 1 auto` + `min-h-0` says the
    // plain thing: be your content's height, and shrink below it once the cap
    // bites (which is what turns overflow into a scroll).
    <div className="relative flex min-h-0 flex-auto flex-col">
      <div
        ref={listRef}
        // `overscroll-contain` stops a flick at the end of this list from
        // handing the scroll on to the page behind the menu.
        className="menu-scroll min-h-0 flex-auto overflow-y-auto overscroll-contain px-1 pb-1"
      >
        {/* A plain wrapper, purely so the ResizeObserver above has one element
            whose box IS the content height. (Not `display:contents` — that
            generates no box at all, so it would report 0×0 forever.) Radix
            collects menu items through context, not DOM parentage, so the extra
            level costs nothing: focus order and typeahead are unaffected. */}
        <div>
          {statuses.map((option) => {
            const isCurrent = option.key === currentKey
            // Columns that aren't a human's to assert are disabled rather than
            // hidden: a missing option reads as a bug, a greyed one with a
            // reason teaches the rule. `title` carries the reason — Radix keeps
            // disabled items out of the tab order, so this is the hover
            // affordance that still fires.
            const blocked = candidate ? manualMoveBlocker(option, candidate) : null
            return (
              <DropdownMenuItem
                key={option._id}
                disabled={isCurrent || pending || blocked !== null}
                title={blocked ?? undefined}
                onSelect={() => onSelect(option.key)}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color ?? "var(--ink-muted)" }}
                />
                <span className="min-w-0 truncate">{option.label}</span>
                {isCurrent ? (
                  <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted" />
                ) : null}
              </DropdownMenuItem>
            )
          })}
        </div>
      </div>
      {/* The "there is more this way" pair. They stop short of the right edge
          (`right-2` = the scrollbar's own 8px) so the groove stays legible
          through them — it is the affordance that survives when a fade is at
          rest. Purely decorative and never hit-testable, so a click near an
          edge still lands on the row under it. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1 right-2 top-0 h-5 bg-linear-to-b from-popover via-popover/70 to-transparent transition-opacity duration-150",
          atTop ? "opacity-0" : "opacity-100",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-0 left-1 right-2 h-7 bg-linear-to-t from-popover via-popover/75 to-transparent transition-opacity duration-150",
          atBottom ? "opacity-0" : "opacity-100",
        )}
      />
    </div>
  )
}
