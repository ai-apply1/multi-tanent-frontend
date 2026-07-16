import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { subscribeToAuthFailure } from "@/lib/api"
import { loginRequest, logoutRequest, meRequest } from "@/features/auth/authApi"
import type { AdminUser } from "@/features/auth/types"

interface AuthContextValue {
  admin: AdminUser | null
  isInitializing: boolean
  isAuthenticating: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const initialized = useRef(false)

  const refreshMe = useCallback(async () => {
    try {
      const me = await meRequest()
      setAdmin(me)
    } catch {
      setAdmin(null)
    }
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    refreshMe().finally(() => setIsInitializing(false))
  }, [refreshMe])

  useEffect(() => {
    return subscribeToAuthFailure(() => {
      setAdmin(null)
    })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setIsAuthenticating(true)
    try {
      const next = await loginRequest(email, password)
      setAdmin(next)
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      setAdmin(null)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ admin, isInitializing, isAuthenticating, login, logout, refreshMe }),
    [admin, isInitializing, isAuthenticating, login, logout, refreshMe]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
