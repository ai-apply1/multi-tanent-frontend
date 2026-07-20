/**
 * Paint an organization's brand onto the dashboard's design tokens.
 *
 * ── Only `primary` is taken, and that is the whole decision ───────────
 *
 * The theme carries nine colours. This maps ONE.
 *
 *  - `secondary` / `accent` here are NOT brand colours despite the names: they
 *    are shadcn SURFACE tokens, a near-white grey in the light theme and a near
 *    black in the dark one, behind secondary buttons and hover states. Painting
 *    an org's brand pink into `--secondary` turns every muted button pink. The
 *    name collides; the meaning does not.
 *  - `background` / `surface` / `foreground` describe the candidate SPA's dark
 *    canvas. This dashboard has its own light and dark themes, and letting a
 *    tenant drive them is how an HR user gets white text on a white page with
 *    no way to recover.
 *  - `success` / `warning` / `danger` are semantic. An org whose brand happens
 *    to be red does not get a red "saved successfully".
 *
 * What an org's `primary` legitimately owns is the ACCENT: the buttons, the
 * focus rings, the active nav item. That is what a customer means by "our
 * colour", and `--ring` already reads `var(--primary)`, so it follows for free.
 *
 * ── Why the foreground is computed rather than left alone ─────────────
 *
 * `--primary-foreground` is the text ON `bg-primary`, and the two themes
 * disagree about it: the light theme pairs a mid-tone purple with near-white
 * ink, the dark theme pairs a LIGHT purple with near-black ink. Override
 * `--primary` and leave the ink, and a dark brand in the dark theme renders
 * near-black text on a near-black button. Across 37 `bg-primary` call sites,
 * that is every primary action in the product.
 *
 * So the ink is chosen by WCAG contrast against whatever colour the org picked.
 * Same rule, and the same reason, as `email-palette.ts` in the backend.
 */

// The colour maths lives in `@/lib/color`, shared with the settings-page
// palette editor. Two copies of a WCAG formula is how they drift apart.
import { parseHex, readableInk } from "@/lib/color"

/**
 * Apply, or undo.
 *
 * `null` REMOVES the overrides rather than writing defaults back, so the
 * stylesheet's own light/dark values resume — including the theme switch, which
 * swaps them. Writing a "default" here would freeze one theme's colours into
 * the other.
 */
export const applyTenantTheme = (primary: string | null): void => {
  const root = document.documentElement
  const rgb = primary ? parseHex(primary) : null

  if (!rgb) {
    root.style.removeProperty("--primary")
    root.style.removeProperty("--primary-foreground")
    return
  }

  root.style.setProperty("--primary", primary as string)
  root.style.setProperty("--primary-foreground", readableInk(rgb))
  // `--ring` is declared as `var(--primary)` in both themes, so focus rings
  // follow without being set here.
}
