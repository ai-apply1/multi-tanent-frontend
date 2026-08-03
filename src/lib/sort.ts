/**
 * Column sorting for the admin tables (Candidates, Jobs, Team).
 *
 * This is CLIENT-SIDE sorting, and the one thing to keep in mind is what that
 * means: every one of those tables is server-paginated, so a click here
 * reorders THE ROWS CURRENTLY ON SCREEN, not the whole result set. Sorting
 * "AI score, highest first" on page 1 of 4 gives you the best of those 25
 * candidates, not the best 25 candidates. The pages say so next to their
 * pagination controls whenever a sort is active and more than one page exists —
 * a page-local sort that LOOKS global is the one way this feature can mislead,
 * so it is stated rather than hidden.
 *
 * What that buys, and why it's a fair trade here: sorting off the loaded rows
 * can order columns the API could never sort on — the job title (a client-side
 * join against the job options), the pipeline stage a status sits at, the AI
 * score (which lives on a populated interview, not the candidate). Every
 * column that carries a meaningful order is sortable, rather than the three or
 * four that happen to be plain fields on the document.
 */

export type SortDir = "asc" | "desc";

/** Which column a table is sorted by, and which way. `null` = server order. */
export interface SortState<F extends string> {
  by: F;
  dir: SortDir;
}

/**
 * What a row contributes to one sort column. Each table maps its own rows to
 * these — a date becomes epoch milliseconds, a status becomes its stage order,
 * a boolean stays a boolean — so the comparator below never needs to know what
 * a candidate or a job is.
 *
 * `null`/`undefined`/`NaN` all mean THE ROW HAS NO VALUE HERE (no interview
 * score yet, never logged in, a job that isn't in the loaded options).
 */
export type SortValue = string | number | boolean | null | undefined;

/**
 * The state after clicking `field`'s header.
 *
 * A two-state toggle, deliberately: a new column adopts `firstDir` (whatever
 * reads as "the interesting end" for that data — A→Z for names, highest-first
 * for scores, newest-first for dates), and clicking the active column flips it.
 * There is no third "unsorted" state, because on these tables it would be a
 * no-op that looks broken: the server already returns newest-first, so
 * un-sorting the Date column leaves the rows exactly where they are while the
 * arrow disappears.
 */
export function nextSortState<F extends string>(
  current: SortState<F> | null,
  field: F,
  firstDir: SortDir,
): SortState<F> {
  if (current?.by !== field) return { by: field, dir: firstDir };
  return { by: field, dir: current.dir === "asc" ? "desc" : "asc" };
}

const isBlank = (value: SortValue): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "number" && Number.isNaN(value));

/** Compare two present values. Strings collate, everything else goes numeric. */
function compareFilled(a: SortValue, b: SortValue): number {
  if (typeof a === "string" && typeof b === "string") {
    // `sensitivity: "base"` is what stops "alice" sorting after "Zoe" — these
    // are hand-typed names and titles, so their casing is whatever the typist
    // did, and a byte-order sort visibly disagrees with the column it orders.
    // `numeric` gives "Level 2" before "Level 10" instead of the reverse.
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  }
  // Booleans coerce to 0/1, so "active before inactive" needs no special case.
  const na = Number(a);
  const nb = Number(b);
  // Only reachable if a column returns mixed types, which none do — but an
  // arbitrary non-zero here would scatter the rows rather than leave them put.
  if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
  if (na === nb) return 0;
  return na < nb ? -1 : 1;
}

/**
 * A sorted COPY of `rows`. Never sorts in place: `rows` is react-query's cached
 * array, and `Array.prototype.sort` mutates — reordering it would rewrite the
 * cache under every other reader of that query.
 *
 * Two behaviours worth relying on:
 *
 *   - **Blank values sink to the bottom in BOTH directions.** A candidate with
 *     no score yet is not "the lowest score", and flipping the arrow should not
 *     promote a screenful of em-dashes to the top. So the blank test runs
 *     before the direction is applied.
 *   - **Ties keep the server's order.** `sort` is stable per spec, so rows the
 *     column can't separate stay newest-first, which is the order they arrived
 *     in — no reshuffling on an unrelated refetch.
 */
export function sortRows<T, F extends string>(
  rows: readonly T[],
  state: SortState<F> | null,
  valueOf: (row: T, field: F) => SortValue,
): T[] {
  if (!state) return rows as T[];
  const direction = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((rowA, rowB) => {
    const a = valueOf(rowA, state.by);
    const b = valueOf(rowB, state.by);
    const aBlank = isBlank(a);
    const bBlank = isBlank(b);
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;
    if (bBlank) return -1;
    return direction * compareFilled(a, b);
  });
}

/**
 * Epoch ms for an API date string, or `null` when there isn't one — the shape
 * {@link sortRows} wants for a date column.
 *
 * `Date.parse` of an unparseable string is `NaN`, which {@link isBlank} already
 * treats as absent, so a malformed timestamp sinks to the bottom instead of
 * scattering rows randomly.
 */
export function dateSortValue(value: string | null | undefined): number | null {
  if (!value) return null;
  return Date.parse(value);
}

/**
 * Position of `value` in `order`, for columns whose meaning is a sequence
 * rather than an alphabet — a job's lifecycle (draft → open → closed →
 * archived), a member's role. Sorting those A–Z would interleave them
 * arbitrarily; sorting by rank groups them the way the product does.
 *
 * An unrecognised value returns `null`, so a status this build doesn't know
 * about sinks to the bottom rather than silently ranking first.
 */
export function rankSortValue<T>(
  value: T,
  order: readonly T[],
): number | null {
  const index = order.indexOf(value);
  return index === -1 ? null : index;
}
