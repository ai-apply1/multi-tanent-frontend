/**
 * Date rendering for the whole dashboard.
 *
 * Every table that shows a timestamp — Jobs' "Created", Candidates' "Applied",
 * Question Bank's "Updated", Team's "Last login" — wants one of exactly two
 * formats, so they live here rather than as a private copy per page (there
 * were four, three of them byte-identical).
 *
 * Both are locale-driven (`undefined` locale = the browser's) and both render
 * the app's `—` placeholder for a missing OR unparseable value: a raw ISO
 * string leaking into a table cell is noise, and an "Invalid Date" is worse.
 */

/** Date only — "Mar 4, 2026". For "when did this happen" columns. */
export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Date + time — "Mar 04, 2026, 09:15 AM". For audit-ish columns. */
export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
