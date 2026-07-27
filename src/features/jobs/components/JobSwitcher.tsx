import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Check, ChevronDown, Loader2, Search } from "lucide-react";
import { listJobs } from "@/features/jobs/jobsApi";
import { JOB_STATUS_LABELS, type JobStatus } from "@/features/jobs/types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { jobDetail } from "@/routes";
import { cn } from "@/lib/utils";

/**
 * How many jobs one popover shows. The backend caps `limit` at 100; 20 keeps
 * the list scannable, and the footer discloses when more matches exist rather
 * than letting the cap read as "that's all of them".
 */
const RESULT_LIMIT = 20;

/** Panel width in px. Kept in step with the `w-[340px]` class on the panel —
 *  the open effect measures against it to keep the panel on-screen. */
const PANEL_WIDTH = 340;

/** Breathing room kept between the panel and either viewport edge. Mirrors the
 *  `max-w-[calc(100vw-2rem)]` cap on the panel (2rem = both margins). */
const VIEWPORT_MARGIN = 16;

/**
 * The only fields a row needs. The current job is contributed by the page from
 * its own detail query; every other row comes from the list endpoint.
 */
interface SwitcherRow {
  _id: string;
  title: string;
  status: JobStatus;
}

interface JobSwitcherProps {
  currentJobId: string;
  currentTitle: string;
  currentStatus: JobStatus;
}

/**
 * GitHub-style "switch job" picker for the job detail header: a chevron button
 * that opens a searchable list of the org's jobs and navigates to whichever one
 * is chosen, with the current job checked.
 *
 * Built on a plain button + an absolutely positioned panel rather than Radix
 * `DropdownMenu` for the same reason `ui/combobox` is: a menu owns the keyboard
 * for its own typeahead, so a text input inside it fights for every keystroke.
 * Focus stays in the search box and the rows are driven by `aria-activedescendant`
 * (the standard combobox pattern), so the arrow keys never move DOM focus.
 */
export function JobSwitcher({
  currentJobId,
  currentTitle,
  currentStatus,
}: JobSwitcherProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  /** Panel x-offset from the trigger, in px. 0 = left-aligned under the
   *  chevron (GitHub's placement); negative pulls it back to stay on-screen. */
  const [offsetLeft, setOffsetLeft] = useState(0);
  const trimmed = search.trim();
  const debounced = useDebouncedValue(trimmed, 250);
  /*
   * Typing is debounced, but CLEARING is immediate. Debouncing an empty box
   * both ways leaves a 250ms window where `rows` still holds the old query's
   * matches: closing the panel (which clears `search`) would replay the last
   * search on reopen, and clearing a no-match search would render
   * `No jobs match ""`. An empty box has nothing to rate-limit, so it applies
   * at once and both windows close.
   */
  const effectiveSearch = trimmed === "" ? "" : debounced;

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const rowId = (index: number) => `${listId}-row-${index}`;

  /*
   * Search runs SERVER-SIDE instead of filtering a cached page: an org can hold
   * more jobs than one page returns, so client-side filtering would silently
   * hide every match that didn't happen to land on page 1.
   *
   * Keyed under the `["jobs", ...]` prefix that every job mutation already
   * invalidates (status change, edit, create, delete, CV import), so this list
   * can't serve a title or status the rest of the app has moved past. The
   * second key element is a STRING while the Jobs table's is an OBJECT —
   * distinct entries sharing a prefix, never one key holding two shapes.
   */
  const jobsQuery = useQuery({
    queryKey: ["jobs", "switcher", effectiveSearch],
    queryFn: () => listJobs({ limit: RESULT_LIMIT, search: effectiveSearch }),
    enabled: open,
    staleTime: 15_000,
  });

  const rows = useMemo<SwitcherRow[]>(() => {
    const fetched = (jobsQuery.data?.data ?? []).map((job) => ({
      _id: job._id,
      title: job.title,
      status: job.status,
    }));
    // While searching, the list is exactly the server's matches, in the
    // server's order — including the current job if it matched. Pinning it on
    // top of a query it may not match would claim a match that isn't there;
    // filtering it out would hide a real one (searching your own job's title
    // and being told "no jobs match" is worse than either).
    if (effectiveSearch) return fetched;
    // With no query the current job LEADS, so the switcher always shows where
    // you are even when this job sits past `RESULT_LIMIT`. It's contributed
    // from props, so it's dropped from the page to avoid a duplicate row.
    return [
      { _id: currentJobId, title: currentTitle, status: currentStatus },
      ...fetched.filter((job) => job._id !== currentJobId),
    ];
  }, [
    jobsQuery.data,
    currentJobId,
    currentTitle,
    currentStatus,
    effectiveSearch,
  ]);

  // Close → wipe the session, so the next open starts on the full unfiltered
  // list instead of replaying the last search.
  useEffect(() => {
    if (open) return;
    setSearch("");
    setActive(0);
  }, [open]);

  // Open → put the caret in the search box. The panel mounts in the same
  // commit, so by the time this effect runs the input is in the DOM.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  /*
   * Open → position the panel horizontally. There is no positioning library
   * here (a plain absolute panel, not a Radix portal with collision detection),
   * and the trigger's x is not fixed: it sits after the job title in a wrapping
   * flex row, so a long title pushes it right and a narrow viewport wraps it
   * back to the left.
   *
   * This CLAMPS rather than flipping edges. A binary left/right flip cannot
   * solve the narrow-viewport case, because there the panel fits on NEITHER
   * edge — anchoring right just moves the overflow to the left, which is
   * strictly worse: the app shell is `overflow-hidden` and an LTR scroll
   * container cannot expose negative-x overflow, so that side is unreachable.
   * Offsetting from the left-aligned ideal by exactly as much as it takes to
   * fit keeps the whole panel on-screen at every width.
   *
   * `useLayoutEffect`, not `useEffect`: this runs in the commit that MOUNTS the
   * panel, so a passive effect would paint once at the unclamped offset and
   * then snap sideways.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = containerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      // The rendered width, not the constant: `max-w` caps it on small screens.
      const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
      const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
      const clamped = Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft));
      // Expressed relative to the anchor, since the panel is absolute inside it.
      setOffsetLeft(Math.round(clamped - anchor.left));
    };
    measure();
    // A resize while the panel is open invalidates the measurement.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  // A shrinking result set must never leave the highlight pointing past the
  // end of the list (which would make Enter a no-op).
  useEffect(() => {
    if (active > 0 && active >= rows.length) setActive(0);
  }, [rows.length, active]);

  // Arrow keys can walk the highlight past the visible edge of the scroll box.
  // `block: "nearest"` leaves an already-visible row where it is.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open, rows.length]);

  // Click anywhere outside the trigger + panel closes it. `mousedown` (not
  // `click`) so the panel is gone before the click lands on what's underneath.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const close = ({ refocus }: { refocus?: boolean } = {}) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const go = (jobId: string) => {
    // Re-navigating to the job we're already on would remount the page for no
    // reason, so selecting the checked row just closes the picker.
    close({ refocus: jobId === currentJobId });
    if (jobId !== currentJobId) navigate(jobDetail(jobId));
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      // Clamped to `length - 1` AND floored at 0: on an empty list the former
      // alone is -1, which no later clamp repairs, and `rows[-1]` would leave
      // the highlight blank and Enter dead once results came back.
      setActive((a) => Math.max(Math.min(a + 1, rows.length - 1), 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row) go(row._id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close({ refocus: true });
    } else if (event.key === "Tab") {
      // Tab means "leave". Not `preventDefault`ed — the browser's own focus
      // move is what we want; closing just takes the panel down with it. The
      // rows carry `tabIndex={-1}` so Tab can't land inside a panel that is
      // about to unmount.
      close();
    }
    // Home/End are deliberately NOT handled: inside an editable textbox they
    // are the only way to jump the caret to the start/end of the query.
  };

  const totalMatches = jobsQuery.data?.count ?? 0;
  // Counted from the rows actually RENDERED, not the raw page: with no search
  // the pinned current job may add a row the page didn't contain, and a footer
  // that says "showing 20" under 21 visible rows reads as a bug.
  const hasMore = totalMatches > rows.length;
  const isEmpty =
    !jobsQuery.isLoading && !jobsQuery.isError && rows.length === 0;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title="Switch job"
        aria-label="Switch job"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--field-border)] bg-surface text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]",
          open && "bg-hover text-ink",
        )}
      >
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          strokeWidth={1.9}
        />
      </button>

      {open ? (
        <div
          // `left` is measured, not a class — see the layout effect above.
          style={{ left: offsetLeft }}
          /*
           * Keep focus in the search box for a press anywhere on the panel's
           * own chrome — the heading, the padding around the search field, the
           * list's gutter, the status line, the footer. Without this, focus
           * falls to <body> while the panel stays open (the outside-click
           * closer sees the target inside `containerRef` and bails), and
           * `onSearchKeyDown` is bound to the INPUT — a sibling of that chrome,
           * not an ancestor — so no key can reach it: typing, the arrow keys,
           * Enter and even Escape all go dead with the panel still covering the
           * page. The input is exempt so it keeps its own caret placement and
           * drag-select. `preventDefault` on mousedown does not suppress the
           * following `click`, so the rows' `onClick` still fires.
           */
          onMouseDown={(event) => {
            if (event.target !== inputRef.current) event.preventDefault();
          }}
          className="absolute top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-popover text-popover-foreground shadow-[0_12px_34px_rgba(13,11,11,0.16)]"
        >
          <p className="border-b border-line px-3 py-2.5 text-[12px] font-semibold text-ink">
            Switch job
          </p>

          <div className="p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                strokeWidth={1.9}
              />
              <input
                ref={inputRef}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search jobs…"
                autoComplete="off"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  rows[active] ? rowId(active) : undefined
                }
                className="h-9 w-full rounded-lg border border-[var(--field-border)] bg-surface pl-8 pr-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)]"
              />
            </div>
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Jobs"
            className="scroll max-h-[264px] overflow-y-auto px-1.5 pb-1.5"
          >
            {rows.map((row, index) => {
              const isCurrent = row._id === currentJobId;
              return (
                <button
                  key={row._id}
                  id={rowId(index)}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  // Options are driven by `aria-activedescendant` from the
                  // search box, so they must stay out of the tab order — focus
                  // never leaves the input while the panel is open.
                  tabIndex={-1}
                  data-active={index === active ? "true" : undefined}
                  onMouseEnter={() => setActive(index)}
                  // No `onMouseDown` guard here — the panel-level one above
                  // covers rows too (mousedown bubbles), including the
                  // press-a-row-release-off gesture that fires no click.
                  onClick={() => go(row._id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13.5px] transition-colors",
                    index === active ? "bg-surface-3 text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {isCurrent ? (
                      <Check
                        className="h-4 w-4 text-primary"
                        strokeWidth={2.4}
                      />
                    ) : null}
                  </span>
                  <Briefcase
                    className="h-4 w-4 shrink-0 text-ink-subtle"
                    strokeWidth={1.8}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isCurrent && "font-semibold text-ink",
                    )}
                    title={row.title}
                  >
                    {row.title}
                  </span>
                  {/* Open is the expected state, so only the exceptions are
                      labelled — a status on every row would just be noise. */}
                  {row.status !== "open" ? (
                    <span className="shrink-0 text-[11.5px] font-semibold text-ink-muted">
                      {JOB_STATUS_LABELS[row.status]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Status lives OUTSIDE the listbox: a `role="listbox"` may only
              contain options, and a message parked among them is skipped by a
              screen reader whose focus stays in the search box. As a polite
              live region it is announced instead. `effectiveSearch` (not the
              raw box) is quoted so the message can never name a term the rows
              were not built from. */}
          {jobsQuery.isLoading || jobsQuery.isError || isEmpty ? (
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-center gap-2 px-3 pb-2.5 text-[13px]",
                jobsQuery.isError ? "text-[var(--danger)]" : "text-ink-muted",
              )}
            >
              {jobsQuery.isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading jobs…
                </>
              ) : jobsQuery.isError ? (
                "Could not load jobs."
              ) : effectiveSearch ? (
                `No jobs match “${effectiveSearch}”.`
              ) : (
                "No jobs yet."
              )}
            </p>
          ) : null}

          {hasMore ? (
            <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-muted">
              Showing {rows.length} of {totalMatches}. Search to narrow it down.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
