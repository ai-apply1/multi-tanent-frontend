import { createContext, useCallback, useContext, useEffect, useState } from "react"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  /**
   * Tell the provider what light/dark mode the ORG has saved.
   *
   * Call it whenever the org's mode is known or changes; it is a no-op unless
   * the org actually changed its mind (see `adoptOrgMode` for why that
   * matters). Safe to call on every render.
   */
  setOrgMode: (mode: Theme | null | undefined) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** The viewer's own choice, made with the header toggle. */
const STORAGE_KEY = "admin-theme"

/**
 * The last org mode this browser has already reacted to.
 *
 * Needed because `STORAGE_KEY` is written on EVERY mount, not only when the
 * viewer touches the toggle — so "has this person expressed a preference?" is
 * unanswerable from that key alone after the first page load. Tracking the org
 * mode separately lets us distinguish "the org changed its mode" (adopt it)
 * from "the org's mode is the same as last time, and this browser is on
 * something else" (leave the viewer alone).
 */
const ORG_MODE_KEY = "admin-theme-org"

function getSystemPreference(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function readTheme(key: string): Theme | null {
  try {
    const v = localStorage.getItem(key)
    if (v === "light" || v === "dark") return v
  } catch {
    // localStorage blocked
  }
  return null
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

/**
 * Light/dark for the HR dashboard.
 *
 * ── Two inputs, and which one wins ─────────────────────────────────────
 *
 * 1. The ORG's saved mode (`theme.mode`), which also drives the candidate
 *    portals. This is the default: an org that has chosen Light should see a
 *    light dashboard without every user having to flip a switch.
 * 2. The VIEWER's toggle in the header, which overrides it for that browser.
 *
 * The org's mode is adopted whenever it CHANGES, rather than only when the
 * viewer has no stored preference. That distinction is the whole design: the
 * stored key is rewritten on every mount, so by the second page load everyone
 * looks like they have a preference and a "only if unset" rule would never fire
 * again — the org could switch to Light and no existing user would ever see it.
 *
 * So: saving a new mode in Settings flips every dashboard, and a viewer who
 * then toggles keeps their choice until the org changes its mind again. Note
 * the deliberate asymmetry with `applyTenantTheme`, which takes only the org's
 * `primary` and ignores its canvas colours. Mode is safe where those are not,
 * because it selects between this dashboard's OWN vetted light and dark
 * palettes rather than painting a tenant's arbitrary hex onto them.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => readTheme(STORAGE_KEY) ?? getSystemPreference(),
  )

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    writeKey(STORAGE_KEY, theme)
  }, [theme])

  const setOrgMode = useCallback((mode: Theme | null | undefined) => {
    if (mode !== "light" && mode !== "dark") return
    const lastSeen = readTheme(ORG_MODE_KEY)
    // Same org mode as last time -> the viewer's own choice stands.
    if (lastSeen === mode) return
    writeKey(ORG_MODE_KEY, mode)
    setTheme(mode)
  }, [])

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"))

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setOrgMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
