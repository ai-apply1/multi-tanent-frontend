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
 *
 * Pass an optional IANA `timeZone` to render the wall-clock value in the org's
 * chosen zone rather than the browser's; an invalid zone name (RangeError)
 * falls back to the browser-local render.
 */

/** Date only — "Mar 4, 2026". For "when did this happen" columns. */
export function formatDate(value?: string | null, timeZone?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (timeZone) {
    try {
      return date.toLocaleDateString(undefined, { ...options, timeZone });
    } catch {
      return date.toLocaleDateString(undefined, options);
    }
  }
  return date.toLocaleDateString(undefined, options);
}

/**
 * Elapsed time — "just now", "12m ago", "3h ago", "yesterday", "Mar 4".
 *
 * For CONVERSATIONAL surfaces (the candidate's HR notes thread), where "how
 * long ago" is what you actually want to know and a full timestamp on every
 * row is noise you have to subtract dates in your head to read. Always pair
 * it with the exact `formatDateTime` in a `title`, so precision is one hover
 * away and never lost.
 *
 * Falls back to an absolute date past a week: "23d ago" is arithmetic, not
 * information, and by then the calendar date is the more useful anchor.
 * A future timestamp (clock skew between the server and this browser) reads
 * as "just now" rather than a nonsensical negative.
 */
export function formatRelativeTime(
  value?: string | null,
  timeZone?: string
): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return formatDate(value, timeZone);
}

/** Date + time — "Mar 04, 2026, 09:15 AM". For audit-ish columns. */
export function formatDateTime(value?: string | null, timeZone?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };
  if (timeZone) {
    try {
      return date.toLocaleString(undefined, { ...options, timeZone });
    } catch {
      return date.toLocaleString(undefined, options);
    }
  }
  return date.toLocaleString(undefined, options);
}
