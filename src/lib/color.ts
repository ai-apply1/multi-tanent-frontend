/**
 * Hex colour parsing and WCAG contrast maths.
 *
 * Extracted from `applyTenantTheme.ts` when the settings page grew a palette
 * editor: both need to answer "is this text readable on that colour?", and two
 * copies of a contrast formula is how they end up disagreeing.
 *
 * The accepted forms are exactly the ones the backend's `HEX_COLOR_REGEX`
 * permits (`#rgb`, `#rrggbb`, `#rrggbbaa`), so anything this module calls valid
 * will survive the PATCH, and anything it rejects would have come back a 400.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * The server's own format check, mirrored. Kept as a literal rather than
 * imported because the two codebases don't share a package, so this is a copy
 * that must be updated in step with `organization.schema.ts`.
 */
export const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export const isHexColor = (value: string): boolean =>
  HEX_COLOR_REGEX.test((value || "").trim())

/**
 * Hex equality, case-insensitively.
 *
 * Always compare colours with this, never `===`. The server lower-cases every
 * hex on write while `<input type="color">` and hand-typed values can be upper
 * case, so a raw string compare reports `#FFFFFF` and `#ffffff` as different —
 * which shows up as a form that stays dirty forever after saving, and as a
 * preset that never registers as selected.
 */
export const sameColor = (a: string, b: string): boolean =>
  (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase()

/**
 * Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. An 8-digit colour's ALPHA IS
 * DISCARDED: a semi-transparent surface has no defined ink colour to contrast
 * against.
 *
 * Returns null for anything unparseable, which is the caller's cue to leave the
 * design tokens alone rather than emit a broken value.
 */
export const parseHex = (value: string): Rgb | null => {
  const hex = (value || "").trim().replace(/^#/, "")
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/**
 * Expand to the 7-char `#rrggbb` that `<input type="color">` requires — it
 * silently shows black for a 3-digit or 8-digit value it can't read, which
 * looks like the org's colour was lost.
 */
export const toInputHex = (value: string): string => {
  const rgb = parseHex(value)
  if (!rgb) return "#000000"
  const pair = (n: number) => n.toString(16).padStart(2, "0")
  return `#${pair(rgb.r)}${pair(rgb.g)}${pair(rgb.b)}`
}

/** WCAG relative luminance. */
export const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1..21. */
export const contrast = (a: Rgb, b: Rgb): number => {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Contrast between two hex strings, or null if either is unparseable — the
 * caller shows nothing rather than a made-up ratio.
 */
export const contrastOf = (a: string, b: string): number | null => {
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (!ra || !rb) return null
  return contrast(ra, rb)
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 }
// The dark-ink option, `#111111`. Kept byte-identical to the apply portal's
// `inkOn` and the screening portal's `readableInk` so the settings preview
// predicts exactly the near-black candidates get (it used to be `#14101f`, the
// dark surface tint, which made the "mirror the portal" claim below untrue).
export const INK: Rgb = { r: 17, g: 17, b: 17 }

/**
 * Readable text on a brand-coloured button. NOT always white: an org can pick
 * `#fbbf24`, and white on amber is illegible.
 */
export const readableInk = (bg: Rgb): string =>
  contrast(bg, WHITE) >= contrast(bg, INK) ? "#ffffff" : "#111111"

/** `readableInk` from a hex string; falls back to white when unparseable. */
export const readableInkOn = (hex: string): string => {
  const rgb = parseHex(hex)
  return rgb ? readableInk(rgb) : "#ffffff"
}

/**
 * Ink for a label spanning SEVERAL fills — a gradient button, where one colour
 * has to survive both ends.
 *
 * Scored against the worst fill, not the first. Picking ink for the start of a
 * gradient is how a label ends up invisible over its own far end. Mirrors
 * `inkOn` in the apply portal so the settings preview predicts what candidates
 * actually get.
 */
export const readableInkOnAll = (hexes: string[]): string => {
  const rgbs = hexes.map(parseHex).filter((c): c is Rgb => c !== null)
  if (rgbs.length === 0) return "#ffffff"
  const worst = (ink: Rgb) => Math.min(...rgbs.map((fill) => contrast(ink, fill)))
  return worst(WHITE) >= worst(INK) ? "#ffffff" : "#111111"
}

/**
 * Blend `tint` into `base` by `weight` (0..1), per sRGB channel, returning
 * `#rrggbb`.
 *
 * A UI derivation for the settings page ("tint the canvas with the brand
 * colour"), not a rendering primitive — the portals do their blending in CSS
 * `color-mix`. It lives here so the hex parsing stays in one module.
 * Unparseable input returns `base` unchanged, the same leave-it-alone rule as
 * `parseHex`.
 */
export const mixHex = (base: string, tint: string, weight: number): string => {
  const a = parseHex(base)
  const b = parseHex(tint)
  if (!a || !b) return base
  const w = Math.min(1, Math.max(0, weight))
  const mix = (x: number, y: number) => Math.round(x + (y - x) * w)
  const pair = (n: number) => n.toString(16).padStart(2, "0")
  return `#${pair(mix(a.r, b.r))}${pair(mix(a.g, b.g))}${pair(mix(a.b, b.b))}`
}

/**
 * `rgba()` from a hex plus an alpha, for inline preview styles that need a
 * translucent tint of a USER-PICKED colour. Appending a hex alpha pair to the
 * raw string would silently corrupt 3-digit hexes; going through `parseHex`
 * handles every accepted form. Unparseable input yields full transparency.
 */
export const hexAlpha = (hex: string, alpha: number): string => {
  const rgb = parseHex(hex)
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : "transparent"
}

/**
 * WCAG AA for body text. 3.0 (AA Large) is deliberately NOT the bar here: the
 * portals set this colour on paragraph copy, not headlines.
 */
export const AA_BODY_CONTRAST = 4.5

/**
 * Is this colour dark enough that a light logo reads better on it than a dark
 * one?
 *
 * Used HERE only for the settings-page contradiction warning: `ThemeCard`
 * compares `isDarkSurface(background)` against the org's STORED `mode` and warns
 * when a hand-edit leaves them disagreeing (a "dark" mode over a light canvas).
 *
 * NOTE: this is NOT how the candidate portals pick a logo variant anymore. They
 * switched to the stored `theme.mode` field (see the apply portal's
 * `logoVariant.ts`), so the luminance derivation below is a UI heuristic for the
 * warning, not the portal's selection rule. Do not re-point the portals at it.
 *
 * The threshold is relative luminance, not "is it #000-ish": a saturated brand
 * navy and a mid-grey both need the light mark, and both would pass a naive
 * per-channel test. 0.45 sits above the midpoint on purpose, because a logo
 * losing contrast fails asymmetrically — a white mark on a mid-tone is merely
 * low-contrast, while a dark mark on the same tone can disappear into it.
 *
 * Unparseable input is treated as LIGHT, so a broken colour falls back to the
 * main logo rather than to a white mark that might land on white.
 */
export const LIGHT_LOGO_LUMINANCE_MAX = 0.45

export const isDarkSurface = (hex: string): boolean => {
  const rgb = parseHex(hex)
  if (!rgb) return false
  return luminance(rgb) <= LIGHT_LOGO_LUMINANCE_MAX
}
