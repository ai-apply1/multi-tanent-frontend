/**
 * Column sorting for the admin tables (Candidates, Jobs, Team).
 *
 * The ordering itself happens on the SERVER — this module is only the click
 * state: which column, which way, and what the next click does. The page puts
 * that state in its query params (`sortBy` / `sortDir`) and renders the rows in
 * the order they arrive.
 *
 * That split is the whole point. These tables are server-paginated, so a sort
 * computed here could only ever reorder THE ROWS ON SCREEN: "AI score, highest
 * first" on page 1 of 4 gave you the best of those 25 candidates, not the best
 * 25 candidates. It was correct enough to be dangerous — the number at the top
 * looked like the answer to a question it wasn't answering — and the pages
 * carried a "Sorted within this page" caveat because nothing better could be
 * said about it. Sorting the whole result set is what the column always meant,
 * and only the server can see the whole result set.
 *
 * Sortable columns and their behaviour on blanks are defined by the backend's
 * sort plans (`common/sort/table-sort.ts` and the per-module `*-sort.ts`
 * files); a field this client sends has to exist there or the request 400s.
 */

export type SortDir = "asc" | "desc";

/** Which column a table is sorted by, and which way. `null` = the API's own order. */
export interface SortState<F extends string> {
  by: F;
  dir: SortDir;
}

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
