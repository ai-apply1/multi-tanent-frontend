import { useId, useState } from "react"
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Pipette,
  Sparkles,
} from "lucide-react"
import type {
  OrganizationTheme,
  ThemeAccentMode,
  ThemeMode,
} from "@/features/organization/types"
import { FONT_OPTIONS } from "@/features/organization/fonts"
import {
  AA_BODY_CONTRAST,
  contrastOf,
  hexAlpha,
  isDarkSurface,
  isHexColor,
  mixHex,
  readableInkOn,
  readableInkOnAll,
  sameColor,
  toInputHex,
} from "@/lib/color"

/**
 * The palette editor for the Branding tab.
 *
 * CONTROLLED, and deliberately so: the settings page owns one Save bar and
 * derives "dirty" by diffing the whole form against the server profile. A card
 * that held its own draft state would either need a second save button or would
 * silently drop edits when the parent reset. It reports changes up as a partial
 * patch and renders whatever it is handed back.
 *
 * ── Shape of the editor ─────────────────────────────────────────────────
 *
 * Two columns on wide screens: controls on the left, a STICKY live preview on
 * the right. The preview used to sit at the bottom of the card, a full screen
 * away from the colour fields it reflected — the single biggest usability
 * complaint with this form. Sticky means every keystroke is visible where the
 * admin is already looking.
 *
 * The first control is a preset grid, because most admins don't want to build
 * a palette — they want to pick one that looks right and maybe swap the
 * primary. Every preset is a complete, contrast-checked look (mode + accent +
 * five colours); status colours are deliberately left alone by presets since
 * their defaults are tuned for readability on any of them.
 *
 * ── Why the canvas colours are grouped away from the brand colours ──────
 *
 * `primary` / `secondary` are safe: pick anything, and the worst case is ugly.
 * `background` / `surface` / `foreground` are not — they are the page and the
 * text on it, and a customer who sets a white foreground on a white background
 * ships an apply page whose copy is invisible to candidates, with no error
 * anywhere. Hence the separate group, the readability checks beside the
 * preview, and the mode presets: picking a readable triple by hand is the one
 * genuinely hard part of this form. "Tint canvas" exists for the same reason —
 * it derives an on-brand canvas from the primary without letting the admin
 * anywhere near an unreadable pair.
 *
 * The warnings do NOT block saving. The backend does not enforce contrast
 * either (it is a documented, unenforced contract), and an org mid-edit with
 * one colour changed and the next not yet picked would otherwise be locked out
 * of its own save button.
 */

const inputBase =
  "h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:bg-ink-faint disabled:text-ink-muted"
const labelBase = "mb-1.5 block text-[13px] font-semibold text-ink"
const sectionTitle = "block text-[13px] font-semibold text-ink"
const sectionHint = "mt-0.5 block text-[12px] leading-relaxed text-ink-muted"

/**
 * The schema defaults, mirrored, so "Reset to platform colours" writes the
 * same values a brand-new org gets (mode, font and the nine colours) rather
 * than clearing the subdoc.
 */
export const PLATFORM_THEME: OrganizationTheme = {
  // Dark, matching the canvas below. Keep the two in step: a mode that
  // contradicted its own defaults would ship every new org a mismatch warning.
  mode: "dark",
  // The typeface every new org ships with, mirroring backend `ThemeFont.JAKARTA`.
  font: "jakarta",
  primary: "#850cff",
  secondary: "#ff00cc",
  accent: "gradient",
  background: "#0b0713",
  surface: "#14101f",
  foreground: "#ffffff",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
}

type CanvasFields = Pick<
  OrganizationTheme,
  "background" | "surface" | "foreground"
>

/** Everything a preset decides. Status colours are deliberately not included. */
type PresetTheme = Pick<
  OrganizationTheme,
  "mode" | "accent" | "primary" | "secondary" | "background" | "surface" | "foreground"
>

/**
 * One-click looks. Each is a COMPLETE palette whose text/canvas pairs clear
 * WCAG AA, so an admin who never opens the advanced fields still ships a
 * readable page. The first entry is the platform default (`PLATFORM_THEME`
 * minus status colours) so "what a new org gets" is always pickable by name.
 *
 * Solid presets store `secondary === primary` rather than leaving a stale
 * gradient end behind: the field is unused while the accent is Solid, but a
 * later switch to Gradient should start from something sane, not from a colour
 * belonging to a look the org already abandoned.
 */
const PRESETS: Array<{ id: string; name: string; theme: PresetTheme }> = [
  {
    id: "violet",
    name: "Violet",
    theme: {
      mode: "dark",
      accent: "gradient",
      primary: "#850cff",
      secondary: "#ff00cc",
      background: "#0b0713",
      surface: "#14101f",
      foreground: "#ffffff",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    theme: {
      mode: "dark",
      accent: "gradient",
      primary: "#3b82f6",
      secondary: "#06b6d4",
      background: "#0b1220",
      surface: "#111a2e",
      foreground: "#e8edf5",
    },
  },
  {
    id: "emerald",
    name: "Emerald",
    theme: {
      mode: "dark",
      accent: "gradient",
      primary: "#10b981",
      secondary: "#2dd4bf",
      background: "#071410",
      surface: "#0e1f18",
      foreground: "#ecfdf5",
    },
  },
  {
    id: "ember",
    name: "Ember",
    theme: {
      mode: "dark",
      accent: "gradient",
      primary: "#f97316",
      secondary: "#ef4444",
      background: "#140b07",
      surface: "#1f120c",
      foreground: "#fff7ed",
    },
  },
  {
    id: "amber",
    name: "Amber",
    theme: {
      mode: "dark",
      accent: "gradient",
      primary: "#f59e0b",
      secondary: "#f43f5e",
      background: "#120e07",
      surface: "#1c1610",
      foreground: "#fefce8",
    },
  },
  {
    id: "indigo",
    name: "Indigo",
    theme: {
      mode: "dark",
      accent: "solid",
      primary: "#6366f1",
      secondary: "#6366f1",
      background: "#0f1115",
      surface: "#171a21",
      foreground: "#e5e7eb",
    },
  },
  {
    id: "mono",
    name: "Mono",
    theme: {
      mode: "dark",
      accent: "solid",
      primary: "#f5f5f5",
      secondary: "#f5f5f5",
      background: "#0a0a0a",
      surface: "#141414",
      foreground: "#fafafa",
    },
  },
  {
    id: "cobalt",
    name: "Cobalt",
    theme: {
      mode: "light",
      accent: "solid",
      primary: "#1d4ed8",
      secondary: "#1d4ed8",
      background: "#f5f7fa",
      surface: "#ffffff",
      foreground: "#111827",
    },
  },
  {
    id: "ivory",
    name: "Ivory",
    theme: {
      mode: "light",
      accent: "solid",
      primary: "#4f46e5",
      secondary: "#4f46e5",
      background: "#f8fafc",
      surface: "#ffffff",
      foreground: "#0f172a",
    },
  },
  {
    id: "breeze",
    name: "Breeze",
    theme: {
      mode: "light",
      accent: "gradient",
      primary: "#0ea5e9",
      secondary: "#6366f1",
      background: "#f0f9ff",
      surface: "#ffffff",
      foreground: "#0f172a",
    },
  },
  {
    id: "meadow",
    name: "Meadow",
    theme: {
      mode: "light",
      accent: "solid",
      primary: "#047857",
      secondary: "#047857",
      background: "#f3faf6",
      surface: "#ffffff",
      foreground: "#0c2a21",
    },
  },
  {
    id: "rosewood",
    name: "Rosewood",
    theme: {
      mode: "light",
      accent: "gradient",
      primary: "#e11d48",
      secondary: "#fb7185",
      background: "#fdf2f6",
      surface: "#ffffff",
      foreground: "#1c1917",
    },
  },
]

/**
 * Compared with `sameColor`, never `===`: the server lower-cases hexes on
 * write, so a freshly-saved org would otherwise stop matching the preset it
 * just picked.
 */
const matchesPreset = (
  value: OrganizationTheme,
  preset: PresetTheme,
): boolean =>
  value.mode === preset.mode &&
  value.accent === preset.accent &&
  sameColor(value.primary, preset.primary) &&
  sameColor(value.secondary, preset.secondary) &&
  sameColor(value.background, preset.background) &&
  sameColor(value.surface, preset.surface) &&
  sameColor(value.foreground, preset.foreground)

/**
 * The two modes, and the canvas each one applies.
 *
 * Colours match the backend's own `set-org-theme.mjs` presets so a palette set
 * from the CLI and one set here land on identical values.
 *
 * Choosing a mode writes `mode` AND the three canvas fields in one change. That
 * pairing is the whole reason the two cannot normally disagree: the schema
 * permits `mode: "light"` over a black page, and nothing server-side rejects
 * it, so this control is what keeps them honest. Brand and status colours are
 * deliberately untouched — a mode switch that silently repainted a customer's
 * brand colour would be a trap on a button labelled "Light".
 */
const MODES: Array<{
  id: ThemeMode
  label: string
  hint: string
  canvas: CanvasFields
}> = [
  {
    id: "light",
    label: "Light",
    hint: "White cards on a near-white page",
    canvas: { background: "#f8fafc", surface: "#ffffff", foreground: "#0f172a" },
  },
  {
    id: "dark",
    label: "Dark",
    hint: "Light text on a deep navy page",
    canvas: { background: "#0b1220", surface: "#111a2e", foreground: "#e8edf5" },
  },
]

/**
 * The neutral bases "Tint canvas" blends the primary into, one trio per
 * polarity. Blend weights are small on purpose: the result should read as "our
 * page, in our colour temperature", not as a primary-coloured page — and small
 * weights are also what keeps the derived pair safely inside the polarity, so
 * the untouched foreground stays readable on it.
 */
const TINT_BASES = {
  dark: { background: "#08080d", surface: "#12121a", bgWeight: 0.12, surfaceWeight: 0.16 },
  light: { background: "#fafafa", surface: "#ffffff", bgWeight: 0.06, surfaceWeight: 0.03 },
} as const

/**
 * Do the canvas colours still look like the mode they claim to be?
 *
 * `mode` is stored, so unlike the old derived label it CAN end up lying: pick
 * Dark, then hand-edit the page colour to white, and every portal keeps
 * choosing the white logo for a white page. Nothing server-side catches that,
 * which makes this warning the only guard there is.
 *
 * Judged on luminance, not on an exact preset match. An org that starts from
 * Dark and nudges its page colour a few shades is still dark and must not be
 * nagged; only crossing the threshold is worth saying anything about.
 */
const modeContradictsCanvas = (
  mode: ThemeMode,
  background: string,
): boolean => {
  if (!isHexColor(background)) return false
  return isDarkSurface(background) !== (mode === "dark")
}

interface ColorFieldProps {
  label: string
  hint: string
  value: string
  onChange: (next: string) => void
  disabled: boolean
}

/**
 * A swatch plus the hex it stands for, both editing the same value.
 *
 * The text input accepts anything while you type — half a hex code is a normal
 * intermediate state, not an error to shout about — and only flags a value that
 * is complete and still wrong. The swatch always shows the last PARSEABLE
 * colour, so it doesn't flash black between the `#` and the first digit.
 */
function ColorField({ label, hint, value, onChange, disabled }: ColorFieldProps) {
  const id = useId()
  const valid = isHexColor(value)

  return (
    <div>
      <label className={labelBase} htmlFor={`${id}-hex`}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-[var(--field-border)]"
          style={{ background: valid ? value : "transparent" }}
        >
          {/*
            The native colour input is scaled past its own bounds and clipped by
            the parent, because browsers draw it as a small swatch inset in a
            bordered chrome box that no CSS can restyle. Blowing it up and
            cropping leaves a flush colour tile that still opens the OS picker.
          */}
          <input
            id={`${id}-swatch`}
            type="color"
            title="Open the colour picker"
            aria-label={`${label} colour picker`}
            value={toInputHex(value)}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
          />
          {/*
            The affordance the bare tile lacked: a swatch reads as a static
            chip, and admins were typing hexes because nothing said "click me".
            pointer-events-none so the click still lands on the input below;
            ink picked against the CURRENT colour so it survives any swatch.
          */}
          <Pipette
            aria-hidden
            className="pointer-events-none absolute right-1 bottom-1 h-3 w-3 opacity-70"
            style={{ color: valid ? readableInkOn(value) : "var(--ink-muted)" }}
          />
        </span>
        <input
          id={`${id}-hex`}
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={!valid}
          placeholder="#000000"
          className={`${inputBase} mono uppercase`}
        />
      </div>
      <p
        className={`mt-1.5 text-[12px] ${valid ? "text-ink-muted" : "text-[var(--danger)]"}`}
      >
        {valid ? hint : "Use a hex colour, like #1d4ed8."}
      </p>
    </div>
  )
}

/**
 * A miniature of the whole look — real canvas, real surface, real CTA fill —
 * so presets are compared by eye, not by name. Buttons, not radios: a preset
 * is an action (write seven fields) rather than a state, and the current
 * palette may match none of them.
 */
function PresetSwatch({
  name,
  theme,
  selected,
  disabled,
  onPick,
}: {
  name: string
  theme: PresetTheme
  selected: boolean
  disabled: boolean
  onPick: () => void
}) {
  const cta =
    theme.accent === "solid"
      ? theme.primary
      : `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onPick}
      className={`rounded-xl border p-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-primary shadow-[0_0_0_3px_var(--accent-ring)]"
          : "border-[var(--line-2)] hover:border-[var(--line)] hover:bg-hover"
      }`}
    >
      <span
        className="block overflow-hidden rounded-lg border border-line"
        style={{ background: theme.background }}
      >
        <span
          className="mx-2 mt-2 mb-2 block rounded-md p-2"
          style={{ background: theme.surface }}
        >
          <span
            className="block h-1.5 w-3/5 rounded-full"
            style={{ background: theme.foreground, opacity: 0.85 }}
          />
          <span
            className="mt-1 block h-1.5 w-2/5 rounded-full"
            style={{ background: theme.foreground, opacity: 0.35 }}
          />
          <span
            className="mt-2 block h-3.5 w-12 rounded-[5px]"
            style={{ background: cta }}
          />
        </span>
      </span>
      <span className="mt-1.5 flex items-center justify-between px-1 pb-0.5">
        <span
          className={`text-[12px] font-semibold ${selected ? "text-primary" : "text-ink"}`}
        >
          {name}
        </span>
        {selected ? (
          <Check className="h-3.5 w-3.5 text-primary" />
        ) : (
          <span className="text-[10.5px] font-medium text-ink-subtle">
            {theme.mode === "dark" ? "Dark" : "Light"}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * One line of the readability check beside the preview: a pass tick or a
 * warning with the actual ratio. Renders nothing while either colour is
 * mid-edit — half a hex has no ratio worth reporting.
 */
function ReadabilityRow({
  label,
  ratio,
  minimum,
}: {
  label: string
  ratio: number | null
  minimum: number
}) {
  if (ratio === null) return null
  const pass = ratio >= minimum
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
        {pass ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
        )}
        {label}
      </span>
      <span
        className={`text-[11.5px] font-semibold ${pass ? "text-ink-muted" : "text-[var(--warning)]"}`}
      >
        {ratio.toFixed(1)}:1
      </span>
    </div>
  )
}

interface ThemeCardProps {
  value: OrganizationTheme
  /** Reports only what changed, so the parent's diff stays honest. */
  onChange: (patch: Partial<OrganizationTheme>) => void
  canWrite: boolean
  /** For the preview only, so it looks like the org's real apply page. */
  logoUrl: string
  /** The dark-background variant, "" when the org uploaded only one mark. */
  logoDarkUrl: string
  orgName: string
}

export function ThemeCard({
  value,
  onChange,
  canWrite,
  logoUrl,
  logoDarkUrl,
  orgName,
}: ThemeCardProps) {
  const set =
    (key: keyof OrganizationTheme) =>
    (next: string): void =>
      onChange({ [key]: next } as Partial<OrganizationTheme>)

  // The font backing the live preview box, resolved from the stored id.
  const selectedFont =
    FONT_OPTIONS.find((f) => f.id === value.font) ?? FONT_OPTIONS[0]

  /*
   * Open when the org has ALREADY customised a status colour — hiding edited
   * values behind a closed fold would misread as "back to defaults". Initial
   * render only (deliberately not synced): collapsing is the reader's choice
   * afterwards, and a Reset mid-session shouldn't slam the fold shut under
   * their cursor.
   */
  const [statusOpen, setStatusOpen] = useState(
    () =>
      !sameColor(value.success, PLATFORM_THEME.success) ||
      !sameColor(value.warning, PLATFORM_THEME.warning) ||
      !sameColor(value.danger, PLATFORM_THEME.danger),
  )

  const onBackground = contrastOf(value.foreground, value.background)
  const onSurface = contrastOf(value.foreground, value.surface)

  /*
   * Which logo variant the portals will show — read from the STORED mode, the
   * same field `logoVariant.ts` reads, so this preview cannot disagree with
   * what candidates get.
   */
  const darkPage = value.mode === "dark"
  const previewLogo = logoDarkUrl && darkPage ? logoDarkUrl : logoUrl

  /** Set when a hand-edited canvas no longer matches the chosen mode. */
  const modeMismatch = modeContradictsCanvas(value.mode, value.background)

  const solid = value.accent === "solid"
  const ctaBackground = solid
    ? value.primary
    : `linear-gradient(90deg, ${value.primary}, ${value.secondary})`
  const ctaInk = solid
    ? readableInkOn(value.primary)
    : readableInkOnAll([value.primary, value.secondary])
  /*
   * The label ink is auto-picked, so unlike the canvas it cannot be FIXED by
   * the admin — but it can still be squeezed: a pale primary and pale
   * secondary leave no ink with real contrast on either end. Scored against
   * the worse end, same rule the portals use. AA-Large is the bar (button
   * labels are short, bold text, not paragraphs).
   */
  const ctaEnds = solid ? [value.primary] : [value.primary, value.secondary]
  const ctaRatios = ctaEnds
    .map((end) => contrastOf(ctaInk, end))
    .filter((r): r is number => r !== null)
  const ctaRatio = ctaRatios.length ? Math.min(...ctaRatios) : null

  const activePreset = PRESETS.find((p) => matchesPreset(value, p.theme))

  const tintCanvas = (): void => {
    const base = TINT_BASES[value.mode]
    onChange({
      background: mixHex(base.background, value.primary, base.bgWeight),
      surface: mixHex(base.surface, value.primary, base.surfaceWeight),
    })
  }

  return (
    <div className="rounded-2xl border border-line">
      <div className="border-b border-line px-4 py-3.5">
        <h3 className="text-[14px] font-semibold text-ink">Brand colours</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          These paint your careers and apply pages, the screening interview, and
          the buttons in candidate emails. The colours are for candidates, not
          your team: this dashboard keeps its own palette apart from the accent.
          Light or dark is the exception, it sets the default here too.
        </p>
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-7 lg:p-5">
        {/* ================= Controls ================= */}
        <div className="grid min-w-0 content-start gap-6">
          {/* ---- Presets ---- */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <span className={sectionTitle}>Quick themes</span>
                <span className={sectionHint}>
                  A complete, readable look in one click. Tweak anything below
                  afterwards.
                </span>
              </div>
              {activePreset ? null : (
                <span className="shrink-0 rounded-full border border-[var(--line-2)] px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
                  Custom palette
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PRESETS.map((preset) => (
                <PresetSwatch
                  key={preset.id}
                  name={preset.name}
                  theme={preset.theme}
                  selected={activePreset?.id === preset.id}
                  disabled={!canWrite}
                  onPick={() => onChange(preset.theme)}
                />
              ))}
            </div>
          </div>

          {/* ---- Brand accent ---- */}
          <div className="border-t border-line pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className={sectionTitle}>Brand accent</span>
                <span className={sectionHint}>
                  Buttons, links and highlights on every candidate page.
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Compact segmented control: gradient vs flat fill. */}
                <div className="inline-flex rounded-xl border border-[var(--line-2)] p-1">
                  {(
                    [
                      { id: "gradient" as ThemeAccentMode, label: "Gradient" },
                      { id: "solid" as ThemeAccentMode, label: "Solid" },
                    ] as const
                  ).map((mode) => {
                    const selected = value.accent === mode.id
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        disabled={!canWrite}
                        aria-pressed={selected}
                        onClick={() => onChange({ accent: mode.id })}
                        className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          selected
                            ? "bg-accent text-primary"
                            : "text-ink-2 hover:text-ink"
                        }`}
                      >
                        {mode.label}
                      </button>
                    )
                  })}
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    disabled={solid}
                    title={
                      solid
                        ? "Nothing to swap while the accent is Solid"
                        : "Swap primary and secondary"
                    }
                    aria-label="Swap primary and secondary colours"
                    onClick={() =>
                      onChange({
                        primary: value.secondary,
                        secondary: value.primary,
                      })
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line-2)] text-ink-2 transition hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                label="Primary"
                hint="The colour candidates associate with you."
                value={value.primary}
                onChange={set("primary")}
                disabled={!canWrite}
              />
              <ColorField
                label="Secondary"
                hint={
                  solid
                    ? "Stored, but unused while the accent is Solid."
                    : "The far end of the gradient."
                }
                value={value.secondary}
                onChange={set("secondary")}
                disabled={!canWrite}
              />
            </div>

            {/* The accent as candidates get it — a strip, not a description. */}
            <div
              aria-hidden
              className="mt-3 h-2.5 rounded-full border border-line"
              style={{ background: ctaBackground }}
            />
          </div>

          {/* ---- Typeface ---- */}
          <div className="border-t border-line pt-5">
            <div className="mb-3">
              <span className={sectionTitle}>Typeface</span>
              <span className={sectionHint}>
                The font every candidate page and this dashboard is set in. Pick
                one below and see it live in the preview.
              </span>
            </div>

            {/* Live preview box — renders real sample text in the selected
                font (the org's own name up top, a pangram, and a weight ramp),
                so an admin sees the actual result before saving. */}
            <div className="mb-3.5 overflow-hidden rounded-2xl border border-line bg-surface-3">
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-subtle">
                  Preview
                </span>
                <span className="text-[11.5px] font-semibold text-ink-2">
                  {selectedFont.label}
                  <span className="text-ink-muted"> · {selectedFont.hint}</span>
                </span>
              </div>
              <div
                className="px-5 py-4"
                style={{ fontFamily: selectedFont.stack }}
              >
                <div className="truncate text-[28px] font-bold leading-tight text-ink">
                  {orgName || "Your organization"}
                </div>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
                  The quick brown fox jumps over the lazy dog.
                </p>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-[15px] font-normal text-ink-muted">
                    Regular
                  </span>
                  <span className="text-[15px] font-medium text-ink-muted">
                    Medium
                  </span>
                  <span className="text-[15px] font-semibold text-ink-muted">
                    Semibold
                  </span>
                  <span className="text-[15px] font-bold text-ink-muted">
                    Bold
                  </span>
                  <span className="text-[13px] tracking-wide text-ink-subtle">
                    AaBbCc 0123456789
                  </span>
                </div>
              </div>
            </div>

            {/* Selectable options — each label + specimen rendered in its own
                font so the whole set reads as a specimen sheet. */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {FONT_OPTIONS.map((opt) => {
                const selected = value.font === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!canWrite}
                    aria-pressed={selected}
                    onClick={() => onChange({ font: opt.id })}
                    className={`relative flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected
                        ? "border-primary bg-accent ring-1 ring-[var(--accent-ring)]"
                        : "border-[var(--line-2)] hover:border-primary/40 hover:bg-hover"
                    }`}
                  >
                    {selected ? (
                      <Check
                        className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-primary"
                        strokeWidth={2.75}
                      />
                    ) : null}
                    <span
                      style={{ fontFamily: opt.stack }}
                      className={`text-[17px] font-semibold leading-tight ${
                        selected ? "text-primary" : "text-ink"
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span
                      style={{ fontFamily: opt.stack }}
                      className="text-[12.5px] text-ink-muted"
                    >
                      Aa Bb Cc 123
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ---- Canvas ---- */}
          <div className="border-t border-line pt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className={sectionTitle}>Light or dark</span>
                <span className={sectionHint}>
                  How your candidate pages render, which logo they use, and the
                  default for this dashboard. Anyone here can still switch their
                  own view from the header.
                </span>
              </div>
              {/*
                Bound to the STORED mode, so one of the two is always lit — there
                is no "Custom" state. Custom COLOURS are still fine and common;
                they just no longer make the mode unanswerable, because the mode
                is a field rather than a guess about the colours.
              */}
              <div className="flex flex-wrap items-center gap-2">
                {MODES.map((m) => {
                  const selected = value.mode === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!canWrite}
                      title={m.hint}
                      aria-pressed={selected}
                      // Mode and canvas in ONE change: this pairing is what keeps
                      // the two from contradicting each other.
                      onClick={() => onChange({ mode: m.id, ...m.canvas })}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "border-primary bg-accent text-primary"
                          : "border-[var(--line-2)] text-ink-2 hover:bg-hover"
                      }`}
                    >
                      {/* A tick as well as the fill, so the selection is not
                          signalled by colour alone. */}
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {modeMismatch ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-3 py-2.5">
                <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-[var(--warning)]" />
                <p className="text-[12.5px] leading-relaxed text-[var(--warning)]">
                  This is set to {value.mode === "dark" ? "Dark" : "Light"} mode
                  but the page colour is{" "}
                  {value.mode === "dark" ? "light" : "dark"}. Candidates would
                  get the {value.mode === "dark" ? "light" : "dark"} version of
                  your logo on a {value.mode === "dark" ? "light" : "dark"}{" "}
                  page. Pick the other mode, or change the page colour to match.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <ColorField
                label="Background"
                hint="The page behind everything."
                value={value.background}
                onChange={set("background")}
                disabled={!canWrite}
              />
              <ColorField
                label="Surface"
                hint="Cards and panels on top."
                value={value.surface}
                onChange={set("surface")}
                disabled={!canWrite}
              />
              <ColorField
                label="Text"
                hint="Must be readable on both."
                value={value.foreground}
                onChange={set("foreground")}
                disabled={!canWrite}
              />
            </div>

            {canWrite ? (
              <button
                type="button"
                disabled={!isHexColor(value.primary)}
                onClick={tintCanvas}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--line-2)] px-3 py-2 text-[12.5px] font-semibold text-ink-2 transition hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Tint canvas with your brand colour
              </button>
            ) : null}

            {/*
              The consequence of the choice above, in words. The polarity is
              what decides which logo a candidate sees, and that link is
              invisible otherwise: the two settings live in different sections
              (this one and the Branding uploads), so an admin picking "Dark"
              has no way to know it just changed their logo.
            */}
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              {darkPage
                ? "Your candidate pages are a dark theme. "
                : "Your candidate pages are a light theme. "}
              {logoDarkUrl
                ? darkPage
                  ? "Candidates see your dark-background logo."
                  : "Candidates see your main logo; the dark-background one is kept for if you switch."
                : darkPage
                  ? "Candidates see your main logo. If it is dark ink, upload a light version under Logo for dark backgrounds."
                  : "Candidates see your main logo."}
            </p>
          </div>

          {/* ---- Status ---- */}
          <div className="border-t border-line pt-5">
            <button
              type="button"
              aria-expanded={statusOpen}
              onClick={() => setStatusOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div>
                <span className={sectionTitle}>Status colours</span>
                <span className={sectionHint}>
                  Confirmations, warnings and errors on the candidate pages.
                  Tuned for readability out of the box — open only if they clash
                  with your brand.
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-2.5">
                {/* The three current values at a glance, without opening. */}
                <span aria-hidden className="flex items-center gap-1">
                  {[value.success, value.warning, value.danger].map(
                    (hex, index) => (
                      <span
                        key={index}
                        className="h-3.5 w-3.5 rounded-full border border-line"
                        style={{
                          background: isHexColor(hex) ? hex : "transparent",
                        }}
                      />
                    ),
                  )}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-ink-muted transition-transform ${statusOpen ? "rotate-180" : ""}`}
                />
              </span>
            </button>

            {statusOpen ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <ColorField
                  label="Success"
                  hint="Application received."
                  value={value.success}
                  onChange={set("success")}
                  disabled={!canWrite}
                />
                <ColorField
                  label="Warning"
                  hint="Deadlines and cautions."
                  value={value.warning}
                  onChange={set("warning")}
                  disabled={!canWrite}
                />
                <ColorField
                  label="Danger"
                  hint="Failed uploads and errors."
                  value={value.danger}
                  onChange={set("danger")}
                  disabled={!canWrite}
                />
              </div>
            ) : null}
          </div>

          {canWrite ? (
            <div className="flex justify-end border-t border-line pt-4">
              <button
                type="button"
                onClick={() => onChange(PLATFORM_THEME)}
                className="text-[12.5px] font-semibold text-ink-muted transition hover:text-ink"
              >
                Reset to platform colours
              </button>
            </div>
          ) : null}
        </div>

        {/* ================= Preview ================= */}
        {/*
          Sticky beside the controls (below the 60px top bar), so the admin
          never edits a colour they cannot see land. On small screens it drops
          under the controls in normal flow.
        */}
        <div className="min-w-0 lg:sticky lg:top-[76px] lg:self-start">
          <span className={sectionTitle}>Live preview</span>
          <span className={`${sectionHint} mb-3`}>
            Roughly what a candidate sees on your apply page. Nothing is saved
            until you hit Save changes.
          </span>

          <div
            className="mt-3 rounded-xl border border-line p-4"
            style={{ background: value.background }}
          >
            <div
              className="rounded-xl p-4"
              style={{ background: value.surface, color: value.foreground }}
            >
              <div className="flex items-center gap-2.5">
                {previewLogo ? (
                  <img
                    src={previewLogo}
                    alt=""
                    className="h-6 w-auto max-w-32 object-contain"
                  />
                ) : (
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[12px] font-bold"
                    style={{
                      background: value.primary,
                      color: readableInkOn(value.primary),
                    }}
                  >
                    {orgName.trim().charAt(0).toUpperCase() || "O"}
                  </span>
                )}
                <span className="text-[13px] font-semibold">{orgName}</span>
              </div>

              <p className="mt-4 text-[16px] font-semibold leading-snug">
                Senior Product Designer
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed opacity-70">
                Remote · Full time. Tell us about your work and record a short
                introduction.
              </p>

              {/*
                A form field, because the apply page is mostly form: field
                chrome is derived from the foreground exactly the way the
                portal derives it, so a washed-out text colour shows up here
                as washed-out field borders too.
              */}
              <div
                className="mt-4 rounded-lg px-3 py-2.5 text-[12.5px]"
                style={{
                  border: `1px solid ${hexAlpha(value.foreground, 0.16)}`,
                  background: hexAlpha(value.foreground, 0.04),
                }}
              >
                <span style={{ color: hexAlpha(value.foreground, 0.45) }}>
                  you@company.com
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                  style={{ background: ctaBackground, color: ctaInk }}
                >
                  Apply now
                </span>
                <span
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                  style={{
                    border: `1px solid ${hexAlpha(value.foreground, 0.2)}`,
                    color: value.foreground,
                  }}
                >
                  View details
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(
                  [
                    { hex: value.success, label: "Submitted" },
                    { hex: value.warning, label: "Closing soon" },
                    { hex: value.danger, label: "Upload failed" },
                  ] as const
                ).map((chip) => (
                  <span
                    key={chip.label}
                    className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                    style={{
                      background: chip.hex,
                      color: readableInkOn(chip.hex),
                    }}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/*
            The safety net, where the admin is already looking. These are the
            same checks the old inline warnings ran, but visible BEFORE things
            break — a passing tick teaches what the bar is, where a warning
            that only ever appears after the fact reads as a scold.
          */}
          <div className="mt-3 rounded-xl border border-line p-3">
            <span className="mb-2 block text-[11.5px] font-semibold tracking-wide text-ink-muted uppercase">
              Readability
            </span>
            <div className="grid gap-1.5">
              <ReadabilityRow
                label="Text on the page"
                ratio={onBackground}
                minimum={AA_BODY_CONTRAST}
              />
              <ReadabilityRow
                label="Text on cards"
                ratio={onSurface}
                minimum={AA_BODY_CONTRAST}
              />
              {/*
                3:1 (AA Large), not 4.5: button labels are short bold text.
                The ink is auto-picked so a failure here means "no ink works
                on this fill" — the fix is a deeper brand colour, and saying
                so beats a bare ratio.
              */}
              <ReadabilityRow
                label="Button label (picked automatically)"
                ratio={ctaRatio}
                minimum={3}
              />
              {ctaRatio !== null && ctaRatio < 3 ? (
                <p className="text-[11.5px] leading-relaxed text-ink-muted">
                  Your brand colours are too pale for any label to sit on them
                  clearly — try a deeper primary or secondary.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
