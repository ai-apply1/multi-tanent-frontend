/**
 * Pure `{{token}}` substitution helpers. The set of available tokens now
 * lives in the admin-managed variable registry (`useVariables`); this file
 * only holds the substitution logic and the candidate-context value builder
 * (the system half of the map, mirrored by the backend `buildCandidateVars`).
 * Custom-variable constants are merged on top from the registry.
 */
export type TemplateVariableMap = Record<string, string>;

/**
 * Link/context tokens only the dedicated scenario sends can fill (the fresh
 * interview link, its expiry, the opt-out link). A generic "send a template"
 * has no link context, so a template using these is blocked.
 */
export const CONTEXT_ONLY_TOKENS = [
  "interviewUrl",
  "interviewExpiry",
  "notInterestedUrl",
];

/**
 * The subset of context-only tokens an applicant-scoped send CAN mint on the
 * fly (a fresh interview link, its expiry, and the opt-out link). When a send
 * opts in to interview-link context, these become fillable, so a follow-up
 * template can be sent through the generic Send Email / SMS action.
 */
export const APPLICANT_LINK_TOKENS = [
  "interviewUrl",
  "interviewExpiry",
  "notInterestedUrl",
];

/** Every distinct `{{token}}` referenced in the given texts. */
export function extractTokens(...texts: string[]): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const text of texts) {
    if (!text) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return [...found];
}

/**
 * Replace every `{{ token }}` in `text` with its value from `vars`. A token
 * is only substituted when it has a non-empty value; otherwise the literal
 * `{{token}}` is kept so the gap is visible to the admin. Surrounding
 * whitespace inside the braces is tolerated (`{{ firstName }}`).
 */
export function applyTemplateVariables(
  text: string,
  vars: TemplateVariableMap,
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, token) => {
    const value = vars[token as string];
    return value === undefined || value === null || value === ""
      ? match
      : String(value);
  });
}

/**
 * Build the substitution map for a real candidate. `firstName` is derived
 * from the full name, `companyName` is constant, and `today` is the current
 * date in a friendly format. Unknown fields are left out (so their tokens
 * stay visible).
 */
export function buildCandidateVariables(input: {
  fullName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
}): TemplateVariableMap {
  const fullName = (input.fullName ?? "").trim();
  const first = fullName.split(/\s+/)[0] ?? "";
  return {
    candidateName: fullName,
    firstName: first,
    companyName: "Jobjen",
    jobTitle: (input.jobTitle ?? "").trim(),
    email: (input.email ?? "").trim(),
    phone: (input.phone ?? "").trim(),
    today: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

// ---------------------------------------------------------------------------
// Inline button markup (mirrors the backend email shell parser)
// ---------------------------------------------------------------------------

/** A call-to-action button parsed from a template body line. */
export type EmailButtonVariant = "primary" | "secondary" | "danger";
export interface ParsedEmailButton {
  label: string;
  url: string;
  variant: EmailButtonVariant;
}

/**
 * Inline button markup an admin can place on its own line anywhere in an
 * email body, kept byte-for-byte in sync with the backend shell parser:
 *
 *   [[button: Click here | https://example.com]]
 *   [[button: Start | {{interviewUrl}} | secondary]]
 *
 * Label and URL are pipe-separated; an optional third field sets the variant
 * (defaults to primary).
 */
const BUTTON_MARKUP_RE =
  /^\[\[\s*button\s*:\s*([^|]+?)\s*\|\s*([^|]+?)\s*(?:\|\s*(primary|secondary|danger)\s*)?\]\]$/i;

/** Build the canonical markup string for a button (used by the inserter). */
export function buildButtonMarkup(
  label: string,
  url: string,
  variant: EmailButtonVariant = "primary",
): string {
  const base = `[[button: ${label.trim()} | ${url.trim()}`;
  return variant === "primary" ? `${base}]]` : `${base} | ${variant}]]`;
}

/** Parse one line into a button, or null when it is not button markup. */
export function parseButtonLine(line: string): ParsedEmailButton | null {
  const m = BUTTON_MARKUP_RE.exec(line.trim());
  if (!m) return null;
  const label = m[1].trim();
  const url = m[2].trim();
  if (!label || !url) return null;
  const variant = (m[3]?.toLowerCase() as EmailButtonVariant) || "primary";
  return { label, url, variant };
}
