/**
 * Paint an organization's brand onto the dashboard's design tokens.
 *
 * ── Full theming under a polarity rule ────────────────────────────────
 *
 * An org's palette declares ONE polarity (`theme.mode`): the canvas colours
 * were chosen to sit together as a light set OR a dark set, never both. So the
 * amount of the palette we apply depends on which mode the VIEWER is currently
 * looking at:
 *
 *  - viewer mode MATCHES `theme.mode` → paint the FULL palette: canvas, text,
 *    lines, semantics, the lot. The org's colours were designed for exactly
 *    this polarity, so they render as intended.
 *  - viewer mode is the OPPOSITE → keep the dashboard's OWN neutral light/dark
 *    palette for canvas and text (which is vetted for that polarity) and apply
 *    only the brand-accent subset — primary, its computed ink, the gradient
 *    fill-end, and the derived hover/active/soft rings. An org's dark navy
 *    canvas must never be inverted to fake a light one; auto-inverting a palette
 *    is how HR ends up with white text on a white page.
 *
 * `--primary-foreground` is always COMPUTED, never taken: the two themes pair a
 * brand colour with opposite ink (mid-tone purple + white ink in light, light
 * purple + near-black ink in dark), so overriding `--primary` while leaving the
 * ink renders near-black text on a near-black button. WCAG picks the ink, and
 * scores it against the WORSE of the button gradient's two ends (primary and the
 * fill-end) so the label survives both — same rule, same reason, as
 * `email-palette.ts`.
 *
 * ── Why a var-map builder, mirrored from the interview portal ──────────
 *
 * `buildBrandVars` returns the finished `Record<key,value>`; `applyTenantTheme`
 * is a `setProperty` loop over it plus a cache write. The map — not the theme —
 * is what gets cached, because the inline boot script in `index.html` replays it
 * before any module parses, and a plain replay can only work if the derivation
 * already lives in the stored VALUES. This is the one place that knows how a
 * variable is derived; the boot script stays a dumb loop and can't drift.
 */

import { isHexColor, readableInkOnAll } from "@/lib/color"
import { fontStackFor } from "@/features/organization/fonts"
import type { OrganizationTheme, ThemeMode } from "@/features/organization/types"

/** Darken toward black — the pressed/hover step derived from a brand primary. */
const darken = (color: string, keepPct: number): string =>
  `color-mix(in srgb, ${color} ${keepPct}%, #000)`

/** Fade toward transparent — a translucent wash that adapts to any canvas. */
const fade = (color: string, pct: number): string =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`

/** Blend `color` a step toward the opaque `toward` colour. */
const mix = (color: string, pct: number, toward: string): string =>
  `color-mix(in srgb, ${color} ${pct}%, ${toward})`

/** The colour itself when it's a valid hex, else null so the caller can skip it. */
const safeHex = (value: string): string | null => (isHexColor(value) ? value : null)

/**
 * Turn a theme + the viewer's current mode into the exact custom properties to
 * write. Split from `applyTenantTheme` so the CACHE stores this map: the boot
 * script in `index.html` replays it and cannot call this function.
 *
 * `--applied-polarity` is a carrier, not a rendered variable: it records which
 * mode this map was built for, so the boot script can tell whether its cached
 * map is the full palette (apply everything) or was captured on the opposite
 * side (apply only the accent-safe keys).
 */
export const buildBrandVars = (
  theme: OrganizationTheme,
  viewerMode: ThemeMode,
): Record<string, string> => {
  const vars: Record<string, string> = { "--applied-polarity": viewerMode }

  // ── Brand typeface — ALWAYS applied, polarity-independent ────────────
  // Drives `--font-sans`, which `body { font-family }` already reads, so the
  // org's chosen font replaces the dashboard default app-wide. Not gated on a
  // valid primary: a font is independent of the colour palette.
  vars["--font-sans"] = fontStackFor(theme.font)

  // ── Accent-safe subset — ALWAYS applied, in either polarity ──────────
  // Needs a valid primary; without one there is no brand to paint and the
  // dashboard's own accent stands.
  if (isHexColor(theme.primary)) {
    const primary = theme.primary
    // "solid" is a single-colour brand: the gradient collapses onto primary at
    // both ends. Resolving it here keeps the fill-end from leaking the mode into
    // components (mirrors the interview portal's `normalizeTheme`).
    const brandSecondary =
      theme.accent === "solid" || !isHexColor(theme.secondary) ? primary : theme.secondary

    vars["--primary"] = primary
    // Scored against BOTH gradient ends, not just primary: an ink chosen for the
    // primary end can vanish over a lighter/darker fill-end. Collapses to
    // `readableInk(primary)` for a solid-accent org (both ends are primary).
    vars["--primary-foreground"] = readableInkOnAll([primary, brandSecondary])
    vars["--brand-secondary"] = brandSecondary
    vars["--btn-fill-end"] = brandSecondary
    // Repointed off the static platform blue so no org — themed or not — flashes
    // a hardcoded hover colour. See globals.css for the same derivation on the
    // untouched-org default.
    vars["--accent-hover"] = darken(primary, 86)
    vars["--accent-active"] = darken(primary, 76)
    // Soft/softer/ring keep the way globals.css derives the ring today
    // (translucent primary), so a single value reads on either polarity's canvas.
    vars["--accent-soft"] = fade(primary, 10)
    vars["--accent-softer"] = fade(primary, 5)
    vars["--accent-ring"] = fade(primary, 34)
  }

  // ── Full palette — ONLY when the viewer's mode matches the org's ─────
  if (viewerMode === theme.mode) {
    const bg = safeHex(theme.background)
    const surface = safeHex(theme.surface)
    const fg = safeHex(theme.foreground)

    // All three core canvas colours or none: a half-applied canvas is how a bad
    // hex leaves readable ink on an unreadable surface. If any is junk, the
    // dashboard's neutral canvas stands for this polarity too.
    if (bg && surface && fg) {
      vars["--background"] = bg
      vars["--surface"] = surface
      vars["--card"] = surface
      vars["--popover"] = surface
      vars["--card-foreground"] = fg
      vars["--popover-foreground"] = fg

      // `--surface-2` is the RECESSED canvas (== background in both modes today):
      // in dark it is darker than the cards, so a "toward foreground" nudge would
      // invert the depth. `--surface-3` lifts a hair of ink off the surface.
      vars["--surface-2"] = bg
      vars["--surface-3"] = mix(surface, 95, fg)
      vars["--hover"] = fade(fg, 5)

      vars["--foreground"] = fg
      vars["--ink"] = fg
      // Ink ladder — foreground faded in steps that match the existing token
      // weights (interview-portal precedent: muted text is a 60% fade).
      vars["--ink-2"] = fade(fg, 85)
      vars["--ink-muted"] = fade(fg, 60)
      vars["--muted-foreground"] = fade(fg, 60)
      vars["--ink-subtle"] = fade(fg, 42)
      vars["--ink-faint"] = fade(fg, 6)

      // Hairlines and field borders, translucent so they tint to the foreground.
      vars["--line"] = fade(fg, 10)
      vars["--line-2"] = fade(fg, 14)
      vars["--field-border"] = fade(fg, 22)
      vars["--border"] = fade(fg, 10)
      vars["--input"] = fade(fg, 22)

      vars["--sidebar"] = surface
      vars["--sidebar-foreground"] = fg
      vars["--sidebar-border"] = fade(fg, 10)
    }

    // Semantics fall back individually — a bad `danger` shouldn't drag `success`
    // back to the platform green. Softs need the canvas to mute against.
    const success = safeHex(theme.success)
    const warning = safeHex(theme.warning)
    const danger = safeHex(theme.danger)
    if (bg && success) {
      vars["--success"] = success
      vars["--success-soft"] = mix(success, 14, bg)
    }
    if (bg && warning) {
      vars["--warning"] = warning
      vars["--warning-soft"] = mix(warning, 14, bg)
    }
    if (bg && danger) {
      vars["--danger"] = danger
      vars["--danger-soft"] = mix(danger, 14, bg)
    }
    // `--stage-*` are left static: a fixed funnel legend, not brand surfaces.
  }

  return vars
}

/**
 * Every custom property the builder can emit. Its matching-polarity output is
 * the superset (accent subset + full palette + carrier), so the keys of one
 * all-valid build are the exact set to clear on a re-apply or teardown — no
 * hand-maintained list to drift from `buildBrandVars`.
 */
const PROBE_THEME: OrganizationTheme = {
  mode: "light",
  font: "jakarta",
  primary: "#000000",
  secondary: "#000000",
  accent: "gradient",
  background: "#000000",
  surface: "#000000",
  foreground: "#000000",
  success: "#000000",
  warning: "#000000",
  danger: "#000000",
}
const MANAGED_KEYS: readonly string[] = Object.keys(buildBrandVars(PROBE_THEME, "light"))

/** Namespaced by hostname (the org this domain fronts) — matches the boot script. */
const brandCacheKey = (): string =>
  "admin-brand-vars:" + window.location.hostname.toLowerCase()

const cacheBrandVars = (vars: Record<string, string>): void => {
  try {
    localStorage.setItem(brandCacheKey(), JSON.stringify(vars))
  } catch {
    // Storage disabled/full/private — the cache only removes a first-paint
    // flash; losing it costs one neutral boot, never correctness.
  }
}

const clearBrandCache = (): void => {
  try {
    localStorage.removeItem(brandCacheKey())
  } catch {
    // ignore
  }
}

/**
 * Apply an org's brand for the viewer's current mode, or undo it.
 *
 * Every managed key is cleared FIRST, unconditionally: a re-apply may be
 * narrowing from the full palette to the accent-only subset (the viewer toggled
 * to the opposite polarity), and a leftover `--background`/`--surface` would
 * paint the org's canvas under the dashboard's own neutral one.
 *
 * `null` removes the overrides and clears the cache, so the stylesheet's own
 * light/dark values resume — including the theme switch, which swaps them.
 */
export const applyTenantTheme = (
  theme: OrganizationTheme | null,
  viewerMode: ThemeMode,
): void => {
  if (typeof document === "undefined") return
  const root = document.documentElement

  for (const key of MANAGED_KEYS) root.style.removeProperty(key)

  if (!theme) {
    clearBrandCache()
    return
  }

  const vars = buildBrandVars(theme, viewerMode)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  cacheBrandVars(vars)
}
