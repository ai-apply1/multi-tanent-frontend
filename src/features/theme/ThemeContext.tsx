import { createContext, useContext, useEffect, useState } from "react"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "admin-theme"

function getSystemPreference(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === "light" || v === "dark") return v
  } catch {
    // localStorage blocked
  }
  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemPreference())

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
