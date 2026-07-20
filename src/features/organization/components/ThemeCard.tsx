import { useId } from "react"
import { AlertTriangle, Check } from "lucide-react"
import type {
  OrganizationTheme,
  ThemeAccentMode,
  ThemeMode,
} from "@/features/organization/types"
import {
  AA_BODY_CONTRAST,
  contrastOf,
  isDarkSurface,
  isHexColor,
  readableInkOn,
  readableInkOnAll,
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
 * ── Why the canvas colours are grouped away from the brand colours ──────
 *
 * `primary` / `secondary` are safe: pick anything, and the worst case is ugly.
 * `background` / `surface` / `foreground` are not — they are the page and the
 * text on it, and a customer who sets a white foreground on a white background
 * ships an apply page whose copy is invisible to candidates, with no error
 * anywhere. Hence the separate group, the contrast warnings, and the two canvas
 * presets: picking a readable triple by hand is the one genuinely hard part of
 * this form.
 *
 * The warnings do NOT block saving. The backend does not enforce contrast
 * either (it is a documented, unenforced contract), and an org mid-edit with
 * one colour changed and the next not yet picked would otherwise be locked out
 * of its own save button.
 */

const inputBase =
  "h-11 w-full rounded-lg border border-[var(--field-border)] bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-primary focus:shadow-[0_0_0_3px_var(--accent-ring)] disabled:cursor-not-allowed disabled:bg-ink-faint disabled:text-ink-muted"
const labelBase = "mb-1.5 block text-[13px] font-semibold text-ink"

/**
 * The schema defaults, mirrored, so "Reset to platform colours" writes the
 * same nine values a brand-new org gets rather than clearing the subdoc.
 */
export const PLATFORM_THEME: OrganizationTheme = {
  // Dark, matching the canvas below. Keep the two in step: a mode that
  // contradicted its own defaults would ship every new org a mismatch warning.
  mode: "dark",
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
            aria-label={`${label} colour picker`}
            value={toInputHex(value)}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
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
 * A contrast warning, shown only when the pair is readable-adjacent enough to
 * have been a real attempt. Renders nothing when either colour is mid-edit.
 */
function ContrastWarning({
  ratio,
  label,
}: {
  ratio: number | null
  label: string
}) {
  if (ratio === null || ratio >= AA_BODY_CONTRAST) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-soft)] px-3 py-2.5">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-[var(--warning)]" />
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        {label} contrast is {ratio.toFixed(1)}:1, below the {AA_BODY_CONTRAST}:1
        readable minimum. Candidates on this page may struggle to read the text.
      </p>
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

  const onBackground = contrastOf(value.foreground, value.background)
  const onSurface = contrastOf(value.foreground, value.surface)

  /*
   * Which logo variant the portals will show — read from the STORED mode, the
   * same field `logoVariant.ts` reads, so this preview cannot disagree with
   * what candidates get.
   *
   * It used to measure this preview card's own surface luminance, which was
   * subtly different from what the portal did (it measures the page canvas) and
   * meant the preview could show one mark while the live site showed the other.
   * One stored field ends that whole class of mismatch.
   */
  const darkPage = value.mode === "dark"
  const previewLogo = logoDarkUrl && darkPage ? logoDarkUrl : logoUrl

  /** Set when a hand-edited canvas no longer matches the chosen mode. */
  const modeMismatch = modeContradictsCanvas(value.mode, value.background)

  const solid = value.accent === "solid"
  const ctaBackground = solid
    ? value.primary
    : `linear-gradient(90deg, ${value.primary}, ${value.secondary})`

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

      <div className="grid gap-5 p-4">
        {/* ---- Accent mode ---- */}
        <div>
          <span className={labelBase}>Accent style</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                {
                  id: "gradient" as ThemeAccentMode,
                  label: "Gradient",
                  hint: "Blends primary into secondary",
                },
                {
                  id: "solid" as ThemeAccentMode,
                  label: "Solid",
                  hint: "Primary only, secondary unused",
                },
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
                  className={`rounded-xl border px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected
                      ? "border-primary bg-accent"
                      : "border-[var(--line-2)] hover:bg-hover"
                  }`}
                >
                  <span
                    className={`block text-[13px] font-semibold ${selected ? "text-primary" : "text-ink"}`}
                  >
                    {mode.label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                    {mode.hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ---- Brand ---- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            label="Primary"
            hint="Buttons, links and the interview page accent."
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

        {/* ---- Canvas ---- */}
        <div className="border-t border-line pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="block text-[13px] font-semibold text-ink">
                Light or dark
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-muted">
                How your candidate pages render, which logo they use, and the
                default for this dashboard. Anyone here can still switch their
                own view from the header.
              </span>
            </div>
            {/*
              Bound to the STORED mode, so one of the two is always lit — there
              is no "Custom" state any more. Custom COLOURS are still fine and
              common; they just no longer make the mode unanswerable, because
              the mode is a field rather than a guess about the colours.
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
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                This is set to {value.mode === "dark" ? "Dark" : "Light"} mode
                but the page colour is{" "}
                {value.mode === "dark" ? "light" : "dark"}. Candidates would get
                the {value.mode === "dark" ? "light" : "dark"} version of your
                logo on a {value.mode === "dark" ? "light" : "dark"} page. Pick
                the other mode, or change the page colour to match.
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

          <div className="mt-3 grid gap-2">
            <ContrastWarning ratio={onBackground} label="Text on background" />
            <ContrastWarning ratio={onSurface} label="Text on surface" />
          </div>
        </div>

        {/* ---- Status ---- */}
        <div className="border-t border-line pt-5">
          <span className="block text-[13px] font-semibold text-ink">
            Status colours
          </span>
          <span className="mt-0.5 mb-3 block text-[12px] text-ink-muted">
            Confirmations, warnings and errors on the candidate pages. The
            defaults are tuned for readability, change them only if they clash.
          </span>
          <div className="grid gap-4 sm:grid-cols-3">
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
        </div>

        {/* ---- Preview ---- */}
        <div className="border-t border-line pt-5">
          <span className="block text-[13px] font-semibold text-ink">
            Preview
          </span>
          <span className="mt-0.5 mb-3 block text-[12px] text-ink-muted">
            Roughly what a candidate sees on your apply page. Live, so it moves
            as you pick, but nothing is saved until you hit Save changes.
          </span>

          <div
            className="rounded-xl border border-line p-5"
            style={{ background: value.background }}
          >
            <div
              className="rounded-xl p-5"
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

              <p className="mt-4 text-[17px] font-semibold leading-snug">
                Senior Product Designer
              </p>
              <p className="mt-1 text-[13px] leading-relaxed opacity-70">
                Remote · Full time. Tell us about your work and record a short
                introduction. It takes about ten minutes.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                  style={{
                    background: ctaBackground,
                    // Both stops when it is a gradient: ink chosen for the
                    // start alone disappears over the far end.
                    color: solid
                      ? readableInkOn(value.primary)
                      : readableInkOnAll([value.primary, value.secondary]),
                  }}
                >
                  Apply now
                </span>
                <span
                  className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                  style={{
                    border: `1px solid ${value.foreground}33`,
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
                    style={{ background: chip.hex, color: readableInkOn(chip.hex) }}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
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
    </div>
  )
}
