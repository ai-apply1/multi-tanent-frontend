import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { subscribeToAuthFailure } from "@/lib/api"
import {
  exitImpersonationRequest,
  loginMfaRequest,
  loginRequest,
  logoutRequest,
  meRequest,
  type LoginOutcome
} from "@/features/auth/authApi"
import type { Impersonation, SessionUser } from "@/features/auth/types"

interface AuthContextValue {
  user: SessionUser | null
  /**
   * Non-null ONLY when a super-admin is acting as `user` (impersonation). The
   * app-wide banner reads this; `exitImpersonation` ends it. Null on a normal
   * HR session.
   */
  impersonation: Impersonation | null
  isInitializing: boolean
  isAuthenticating: boolean
  /**
   * Password step. `identifier` is an email or a userName. Resolves the session
   * directly (`status: "ok"`) OR signals a second factor is required
   * (`status: "mfa_required"` + challenge token), in which case the session is
   * NOT set until `verifyMfa` succeeds.
   */
  login: (identifier: string, password: string) => Promise<LoginOutcome>
  /** Second login step: challenge token + authenticator/recovery code. */
  verifyMfa: (challengeToken: string, code: string) => Promise<void>
  logout: () => Promise<void>
  /** End impersonation: revoke the session server-side and clear local state. */
  exitImpersonation: () => Promise<void>
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [impersonation, setImpersonation] = useState<Impersonation | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const initialized = useRef(false)

  const refreshMe = useCallback(async () => {
    try {
      const me = await meRequest()
      setUser(me.user)
      setImpersonation(me.impersonation)
    } catch {
      setUser(null)
      setImpersonation(null)
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
      setImpersonation(null)
      // The tab is never reloaded on an expired session — ProtectedRoute only
      // routes to /login — so without this the previous org's cached rows
      // survive in the module-level QueryClient for the next admin to log in.
      queryClient.clear()
    })
  }, [queryClient])

  const login = useCallback(
    async (identifier: string, password: string) => {
      setIsAuthenticating(true)
      try {
        // Clear before `setUser` so no render of the shell can ever observe
        // the previous tenant's entries under the new identity.
        queryClient.clear()
        const outcome = await loginRequest(identifier, password)
        // Only a completed login sets the session. An `mfa_required` outcome
        // leaves `user` null so the login page can render the code step without
        // ProtectedRoute treating the caller as authenticated.
        if (outcome.status === "ok") {
          setUser(outcome.user)
          setImpersonation(null)
        }
        return outcome
      } finally {
        setIsAuthenticating(false)
      }
    },
    [queryClient]
  )

  const verifyMfa = useCallback(
    async (challengeToken: string, code: string) => {
      setIsAuthenticating(true)
      try {
        queryClient.clear()
        const next = await loginMfaRequest(challengeToken, code)
        setUser(next)
        setImpersonation(null)
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
      setImpersonation(null)
      queryClient.clear()
    }
  }, [queryClient])

  const exitImpersonation = useCallback(async () => {
    try {
      await exitImpersonationRequest()
    } finally {
      // Like logout: the server has revoked the impersonation session and
      // cleared its cookies, so drop local state even if the request failed.
      setUser(null)
      setImpersonation(null)
      queryClient.clear()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      impersonation,
      isInitializing,
      isAuthenticating,
      login,
      verifyMfa,
      logout,
      exitImpersonation,
      refreshMe
    }),
    [
      user,
      impersonation,
      isInitializing,
      isAuthenticating,
      login,
      verifyMfa,
      logout,
      exitImpersonation,
      refreshMe
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
