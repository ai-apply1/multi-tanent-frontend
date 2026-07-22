import type { ThemeFont } from "./types"

/**
 * The curated brand typefaces an org can pick in Branding. The `id`s are the
 * wire contract shared with the backend `ThemeFont` enum and the two candidate
 * portals; the `stack` is what gets pushed into the `--font-sans` CSS variable
 * that the whole app's `body { font-family }` already reads.
 *
 * Every family here is loaded from Google Fonts in `index.html`, so a stack can
 * name it as the first choice and fall back to the platform's system fonts if
 * the web font has not painted yet.
 */
export interface FontOption {
  id: ThemeFont
  label: string
  /** One-word style descriptor shown under the label in the picker. */
  hint: string
  /** The `font-family` value driven into `--font-sans`. */
  stack: string
}

const SANS_FALLBACK =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"

export const FONT_OPTIONS: readonly FontOption[] = [
  {
    id: "jakarta",
    label: "Plus Jakarta Sans",
    hint: "Modern",
    stack: `"Plus Jakarta Sans", ${SANS_FALLBACK}`,
  },
  {
    id: "inter",
    label: "Inter",
    hint: "Neutral",
    stack: `"Inter", ${SANS_FALLBACK}`,
  },
  {
    id: "poppins",
    label: "Poppins",
    hint: "Geometric",
    stack: `"Poppins", ${SANS_FALLBACK}`,
  },
  {
    id: "montserrat",
    label: "Montserrat",
    hint: "Elegant",
    stack: `"Montserrat", ${SANS_FALLBACK}`,
  },
  {
    id: "roboto",
    label: "Roboto",
    hint: "Classic",
    stack: `"Roboto", ${SANS_FALLBACK}`,
  },
  {
    id: "lora",
    label: "Lora",
    hint: "Serif",
    stack: `"Lora", ui-serif, Georgia, Cambria, "Times New Roman", serif`,
  },
]

/** The platform default, mirroring the backend `ThemeFont.JAKARTA` default. */
export const DEFAULT_THEME_FONT: ThemeFont = "jakarta"

/** The `--font-sans` stack for a stored font id, falling back to the default. */
export const fontStackFor = (font: ThemeFont | undefined | null): string =>
  (FONT_OPTIONS.find((f) => f.id === font) ?? FONT_OPTIONS[0]).stack
