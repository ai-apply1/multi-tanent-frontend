import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { subscribeToAuthFailure } from "@/lib/api"
import { loginRequest, logoutRequest, meRequest } from "@/features/auth/authApi"
import type { SessionUser } from "@/features/auth/types"

interface AuthContextValue {
  user: SessionUser | null
  isInitializing: boolean
  isAuthenticating: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const initialized = useRef(false)

  const refreshMe = useCallback(async () => {
    try {
      const me = await meRequest()
      setUser(me)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    // StrictMode double-invokes effects in dev; without this guard the
    // bootstrap `/me` fires twice and the second one can race the first.
    if (initialized.current) return
    initialized.current = true
    refreshMe().finally(() => setIsInitializing(false))
  }, [refreshMe])

  useEffect(() => {
    return subscribeToAuthFailure(() => {
      setUser(null)
      // The tab is never reloaded on an expired session — ProtectedRoute only
      // routes to /login — so without this the previous org's cached rows
      // survive in the module-level QueryClient for the next admin to log in.
      queryClient.clear()
    })
  }, [queryClient])

  const login = useCallback(
    async (email: string, password: string) => {
      setIsAuthenticating(true)
      try {
        // Clear before `setUser` so no render of the shell can ever observe
        // the previous tenant's entries under the new identity.
        queryClient.clear()
        const next = await loginRequest(email, password)
        setUser(next)
      } finally {
        setIsAuthenticating(false)
      }
    },
    [queryClient]
  )

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      // In the `finally` alongside `setUser`: a failing logout request still
      // tears the session down locally, so the cache must go with it.
      setUser(null)
      queryClient.clear()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({ user, isInitializing, isAuthenticating, login, logout, refreshMe }),
    [user, isInitializing, isAuthenticating, login, logout, refreshMe]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
