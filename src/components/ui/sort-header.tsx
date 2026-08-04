import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { nextSortState, type SortDir, type SortState } from "@/lib/sort";
import { cn } from "@/lib/utils";

/**
 * A sortable column label for the admin tables' header rows.
 *
 * Those headers are grid cells, not `<th>`s (the tables are CSS grids so a row
 * can hold buttons, badges and menus), so this renders a plain `<button>` and
 * carries its state in the accessible name rather than in `aria-sort` — that
 * attribute only means anything inside real table semantics, and announcing it
 * on a `<div>` would be a claim the markup doesn't back.
 *
 * Typography is inherited, not restated: the header row owns the uppercase /
 * tracking / size, and Tailwind's preflight already hands a `<button>` its
 * parent's font. So a sortable and a non-sortable header are the same text at
 * the same weight, and the ONLY difference is the icon — which is exactly the
 * signal "this column can be sorted, that one can't".
 *
 * The icon is always visible, never hover-only. A control you can't see is a
 * control nobody uses, and the whole point of the affordance is that a person
 * who has never clicked a header learns the table sorts.
 *
 * Clicking one of these refetches: the ordering is the server's (see
 * `@/lib/sort`), so `onSortChange` should also send the table back to page 1 —
 * the page you were on named a slice of the OLD order.
 */
export function SortHeader<F extends string>({
  label,
  field,
  sort,
  onSortChange,
  firstDir = "asc",
  align = "start",
  className,
}: {
  /** The column's visible text — also what the accessible name is built from. */
  label: string;
  /** This column's key in the table's sort state. */
  field: F;
  /** The table's current sort, or `null` while it's in server order. */
  sort: SortState<F> | null;
  onSortChange: (next: SortState<F>) => void;
  /**
   * Direction the FIRST click adopts — the end of this column people actually
   * want. `"desc"` for scores, counts and dates (best/most/newest first),
   * `"asc"` for names and pipeline stages.
   */
  firstDir?: SortDir;
  /**
   * Match the column's cells. `"center"` for the numeric columns that render
   * `text-center`, so the header sits over its numbers rather than 6px to
   * their left.
   */
  align?: "start" | "center";
  /** Escape hatch, merged last — `cn` is `twMerge`, so it wins per property. */
  className?: string;
}) {
  const active = sort?.by === field;
  const dir = active ? sort.dir : null;
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;

  // Says what IS and what the click does, because the arrow alone can't: an
  // up arrow on "AI score" is ambiguous until you know whether it means the
  // current order or the one you're about to get.
  const hint = !dir
    ? `Sort by ${label}`
    : dir === "asc"
      ? `Sorted by ${label}, ascending. Click to reverse.`
      : `Sorted by ${label}, descending. Click to reverse.`;

  return (
    <button
      type="button"
      title={hint}
      aria-label={hint}
      onClick={() => onSortChange(nextSortState(sort, field, firstDir))}
      className={cn(
        // No `cursor-pointer` — `globals.css` already sets it on every button.
        "group -my-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1",
        // The hover chip needs padding; the column underneath must not move for
        // it. A left-aligned label cancels the padding with a negative margin so
        // it still starts exactly at the cell edge. A centred one instead fills
        // the cell and centres inside it — a negative margin there would drag
        // the label half a padding off its own numbers.
        align === "center" ? "w-full justify-center" : "-mx-1.5",
        "text-inherit transition-colors hover:bg-hover hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        // The sorted column reads darker than its neighbours, so "which column
        // is driving this order" is answerable without hunting for the arrow.
        active && "text-ink",
        className,
      )}
    >
      {/* `nowrap`, and deliberately NOT `truncate`. The icon costs ~16px, which
          is enough to overrun the narrowest columns ("Applicants",
          "Threshold") on a small window. Ellipsising a nine-letter header to
          "APPLICANT…" reads as a bug; spilling a couple of pixels into the
          12px gutter between columns doesn't read as anything. Wrapping is
          worse than both — it would grow the whole header row. */}
      <span className="whitespace-nowrap">{label}</span>
      <Icon
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          active ? "opacity-100" : "opacity-40 group-hover:opacity-90",
        )}
        strokeWidth={2.2}
      />
    </button>
  );
}

// There is no `SortScopeNote` any more. It said "Sorted within this page",
// which was the honest caveat while sorting ran in the browser over one loaded
// page. The server sorts the whole result set now, so the note would be a
// warning about a limitation that no longer exists.
